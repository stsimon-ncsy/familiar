param(
    [string]$ImagePath = "",
    [switch]$KeepFixture
)

$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

function Get-HResultHex {
    param($Exception)
    if ($null -eq $Exception) { return $null }
    try {
        return ('0x{0:X8}' -f ($Exception.HResult -band 0xffffffff))
    } catch {
        return $null
    }
}

function Get-FailureReason {
    param([string]$Message)
    $lower = "$Message".ToLowerInvariant()
    if ($lower.Contains('appmodel_error_no_package') -or
        $lower.Contains('package identity required') -or
        $lower.Contains('no package identity')) {
        return 'package_identity_required'
    }
    if ($lower.Contains('e_illegal_method_call') -or
        $lower.Contains('winrt') -or
        $lower.Contains('activation') -or
        $lower.Contains('windows.media.ocr')) {
        return 'winrt_ocr_unavailable'
    }
    return 'windows_media_ocr_unavailable'
}

function Write-ProbeResult {
    param(
        [hashtable]$Payload,
        [int]$ExitCode = 0
    )
    $Payload | ConvertTo-Json -Depth 8 -Compress
    exit $ExitCode
}

function New-FamiliarOcrFixture {
    Add-Type -AssemblyName System.Drawing

    $fixturePath = [System.IO.Path]::Combine(
        [System.IO.Path]::GetTempPath(),
        'familiar-ocr-probe-' + [System.IO.Path]::GetRandomFileName() + '.png'
    )
    $bitmap = New-Object System.Drawing.Bitmap 520, 160
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([System.Drawing.Color]::White)
        $font = New-Object System.Drawing.Font 'Arial', 28
        $brush = [System.Drawing.Brushes]::Black
        $graphics.DrawString('Familiar OCR probe 123', $font, $brush, 20, 48)
        $bitmap.Save($fixturePath, [System.Drawing.Imaging.ImageFormat]::Png)
        return $fixturePath
    } finally {
        if ($font) { $font.Dispose() }
        $graphics.Dispose()
        $bitmap.Dispose()
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
    Write-ProbeResult @{
        ok = $false
        backend_available = $false
        reason = Get-FailureReason $message
        message = $message
        exception_type = $_.Exception.GetType().FullName
        hresult = Get-HResultHex $_.Exception
    }
}

$getAwaiterBaseMethod = [WindowsRuntimeSystemExtensions].GetMember('GetAwaiter').Where({
    $PSItem.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
}, 'First')[0]

function Await {
    param($AsyncTask, $ResultType)
    $getAwaiterBaseMethod.MakeGenericMethod($ResultType).Invoke($null, @($AsyncTask)).GetResult()
}

$createdFixture = $false
$resolvedImagePath = $null

try {
    if ([string]::IsNullOrWhiteSpace($ImagePath)) {
        $ImagePath = New-FamiliarOcrFixture
        $createdFixture = $true
    }

    $resolvedImagePath = (Resolve-Path $ImagePath -ErrorAction Stop).Path

    $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $ocrEngine) {
        Write-ProbeResult @{
            ok = $false
            backend_available = $false
            reason = 'ocr_language_pack_unavailable'
            message = 'No Windows OCR language pack is available for the current user profile.'
            image_path = $resolvedImagePath
        }
    }

    $storageFile = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolvedImagePath)) ([Windows.Storage.StorageFile])
    $fileStream = Await ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($fileStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $ocrResult = Await ($ocrEngine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($line in $ocrResult.Lines) {
        $lines.Add(($line.Text -replace '[\x00-\x1f]', ''))
    }

    Write-ProbeResult @{
        ok = $true
        backend_available = $true
        reason = 'ok'
        image_path = $resolvedImagePath
        image_width = [int]$decoder.PixelWidth
        image_height = [int]$decoder.PixelHeight
        lines = $lines
        line_count = $lines.Count
        ocr_engine = 'windows_media_ocr'
    }
} catch {
    $message = $_.Exception.Message
    $classification = Get-FailureReason $message
    Write-ProbeResult @{
        ok = $false
        backend_available = $false
        reason = $classification
        message = $message
        exception_type = $_.Exception.GetType().FullName
        hresult = Get-HResultHex $_.Exception
        image_path = $resolvedImagePath
        ocr_engine = 'windows_media_ocr'
    }
} finally {
    if ($createdFixture -and -not $KeepFixture -and $ImagePath -and (Test-Path $ImagePath)) {
        Remove-Item $ImagePath -Force -ErrorAction SilentlyContinue
    }
    if ($bitmap) { try { $bitmap.Dispose() } catch {} }
    if ($fileStream) { try { $fileStream.Dispose() } catch {} }
}
