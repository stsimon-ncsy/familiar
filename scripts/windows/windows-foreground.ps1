$ProgressPreference = 'SilentlyContinue'

function Write-ForegroundResult {
    param(
        [bool]$Ok,
        [string]$Reason,
        [string]$Message = '',
        [object]$Window = $null
    )

    @{
        ok = $Ok
        reason = $Reason
        message = $Message
        window = $Window
    } | ConvertTo-Json -Compress -Depth 4
}

try {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class FamiliarWin32Foreground {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

    $hwnd = [FamiliarWin32Foreground]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) {
        Write-ForegroundResult -Ok $false -Reason 'foreground_unavailable' -Message 'No foreground window handle was available.'
        exit 0
    }

    $titleBuilder = New-Object System.Text.StringBuilder 1024
    [void][FamiliarWin32Foreground]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity)
    $windowTitle = $titleBuilder.ToString()

    $processId = [uint32]0
    [void][FamiliarWin32Foreground]::GetWindowThreadProcessId($hwnd, [ref]$processId)

    $processName = $null
    if ($processId -gt 0) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($process) {
            $processName = $process.ProcessName
        }
    }

    if (-not $windowTitle -and -not $processName) {
        Write-ForegroundResult -Ok $false -Reason 'foreground_unavailable' -Message 'Foreground window did not expose title or process metadata.'
        exit 0
    }

    Write-ForegroundResult -Ok $true -Reason 'ok' -Window @{
        title = if ($windowTitle) { $windowTitle } else { $null }
        process_name = if ($processName) { $processName } else { $null }
        pid = if ($processId -gt 0) { [int]$processId } else { $null }
    }
}
catch {
    Write-ForegroundResult -Ok $false -Reason 'foreground_unavailable' -Message $_.Exception.Message
}
