param(
    [string[]]$ImagePath = @()
)

$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

$OcrEngineName = 'windows_media_ocr'
$PlatformName = 'windows'

function Get-HResultHex {
    param($Exception)
    if ($null -eq $Exception) { return $null }
    try {
        return ('0x{0:X8}' -f ($Exception.HResult -band 0xffffffff))
    } catch {
        return $null
    }
}

function Remove-ControlCharacters {
    param([string]$Value)
    if ($null -eq $Value) { return '' }
    return ($Value -replace '[\x00-\x1f]', '')
}

function Get-FailureReason {
    param([string]$Message)
    $lower = "$Message".ToLowerInvariant()
    if ($lower.Contains('appmodel_error_no_package') -or
        $lower.Contains('package identity required') -or
        $lower.Contains('no package identity')) {
        return 'package_identity_required'
    }
    if ($lower.Contains('ocr language pack') -or
        $lower.Contains('language pack is available') -or
        $lower.Contains('language pack available')) {
        return 'ocr_language_pack_unavailable'
    }
    if ($lower.Contains('e_illegal_method_call') -or
        $lower.Contains('winrt activation') -or
        $lower.Contains('activation failure') -or
        $lower.Contains('activation failed') -or
        $lower.Contains('class not registered')) {
        return 'winrt_activation_failed'
    }
    if ($lower.Contains('windows.media.ocr') -or
        $lower.Contains('ocrengine') -or
        $lower.Contains('runtime unavailable')) {
        return 'windows_media_ocr_unavailable'
    }
    return 'windows_media_ocr_unavailable'
}

function Write-OcrResult {
    param(
        [hashtable]$Payload,
        [int]$ExitCode = 0
    )
    $Payload | ConvertTo-Json -Depth 8 -Compress
    exit $ExitCode
}

function New-BackendUnavailablePayload {
    param(
        [string]$Reason,
        [string]$Message,
        $Exception = $null
    )
    return @{
        ok = $false
        backend_available = $false
        reason = $Reason
        message = $Message
        exception_type = if ($Exception) { $Exception.GetType().FullName } else { $null }
        hresult = Get-HResultHex $Exception
        ocr_engine = $OcrEngineName
        platform = $PlatformName
        timestamp = (Get-Date).ToUniversalTime().ToString('o')
        results = @{}
    }
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime

    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Foundation.IAsyncOperation`1, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
} catch {
    $message = $_.Exception.Message
    Write-OcrResult (New-BackendUnavailablePayload `
        -Reason (Get-FailureReason $message) `
        -Message $message `
        -Exception $_.Exception)
}

$getAwaiterBaseMethod = [WindowsRuntimeSystemExtensions].GetMember('GetAwaiter').Where({
    $PSItem.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
}, 'First')[0]

function Await {
    param($AsyncTask, $ResultType)
    $getAwaiterBaseMethod.MakeGenericMethod($ResultType).Invoke($null, @($AsyncTask)).GetResult()
}

try {
    $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
} catch {
    $message = $_.Exception.Message
    Write-OcrResult (New-BackendUnavailablePayload `
        -Reason (Get-FailureReason $message) `
        -Message $message `
        -Exception $_.Exception)
}

if ($null -eq $ocrEngine) {
    Write-OcrResult (New-BackendUnavailablePayload `
        -Reason 'ocr_language_pack_unavailable' `
        -Message 'No Windows OCR language pack is available for the current user profile.')
}

$results = @{}

foreach ($sourceImagePath in $ImagePath) {
    $resolvedImagePath = $null
    $bitmap = $null
    $fileStream = $null

    try {
        $resolvedImagePath = (Resolve-Path $sourceImagePath -ErrorAction Stop).Path

        $storageFile = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolvedImagePath)) ([Windows.Storage.StorageFile])
        $fileStream = Await ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($fileStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $ocrResult = Await ($ocrEngine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

        $lineTexts = [System.Collections.Generic.List[string]]::new()
        foreach ($line in $ocrResult.Lines) {
            $lineTexts.Add((Remove-ControlCharacters $line.Text))
        }

        $results[$sourceImagePath] = @{
            ok = $true
            backend_available = $true
            reason = 'ok'
            meta = @{
                ocr_engine = $OcrEngineName
                platform = $PlatformName
                image_width = [int]$decoder.PixelWidth
                image_height = [int]$decoder.PixelHeight
                timestamp = (Get-Date).ToUniversalTime().ToString('o')
            }
            lines = $lineTexts
        }
    } catch {
        $message = $_.Exception.Message
        $reason = Get-FailureReason $message
        $backendAvailable = -not (
            $reason -eq 'package_identity_required' -or
            $reason -eq 'winrt_activation_failed' -or
            $reason -eq 'windows_media_ocr_unavailable' -or
            $reason -eq 'ocr_language_pack_unavailable'
        )
        $results[$sourceImagePath] = @{
            ok = $false
            backend_available = $backendAvailable
            reason = $reason
            message = $message
            exception_type = $_.Exception.GetType().FullName
            hresult = Get-HResultHex $_.Exception
            image_path = $resolvedImagePath
            ocr_engine = $OcrEngineName
            platform = $PlatformName
            timestamp = (Get-Date).ToUniversalTime().ToString('o')
        }
    } finally {
        if ($bitmap) { try { $bitmap.Dispose() } catch {} }
        if ($fileStream) { try { $fileStream.Dispose() } catch {} }
    }
}

Write-OcrResult @{
    ok = $true
    backend_available = $true
    reason = 'ok'
    ocr_engine = $OcrEngineName
    platform = $PlatformName
    timestamp = (Get-Date).ToUniversalTime().ToString('o')
    results = $results
}
