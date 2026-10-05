param(
    [switch]$Preview,
    [switch]$TerminateFixtureProcesses,
    [string]$FixturePath,
    [switch]$TestLauncherCommandParser,
    [string]$TestCommandLine,
    [string]$TestExecutablePath,
    [string]$TestCurrentDirectory
)

$ErrorActionPreference = 'Stop'
if ($FixturePath) {
    if (-not $Preview -and -not $TerminateFixtureProcesses) { throw 'FIXTURE_REQUIRES_PREVIEW_OR_EXPLICIT_FIXTURE_TERMINATION' }
    $fixture = Get-Content -LiteralPath $FixturePath -Raw | ConvertFrom-Json
    $repoRoot = [IO.Path]::GetFullPath([string]$fixture.repoRoot)
    if ($TerminateFixtureProcesses) {
        $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
        if (-not ([IO.Path]::GetFullPath($repoRoot).StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase))) { throw 'TEST_FIXTURE_ROOT_MUST_BE_UNDER_TEMP' }
    }
} else {
    $repoRoot = [IO.Path]::GetFullPath($env:GALGAME_SUPERVISOR_REPO_ROOT)
}
$external = Join-Path $repoRoot 'external-modules'
$servicePorts = [ordered]@{ sillyTavern = 8000; configService = 8791; runtimeBridge = 8795; visualService = 8798; presentationAnalysis = 8801 }
$targets = [ordered]@{
    sillyTavern = Join-Path $repoRoot 'server.js'
    configService = Join-Path $external 'game-config-service\server.mjs'
    runtimeBridge = Join-Path $external 'original-runtime-bridge\server.mjs'
    visualService = Join-Path $external 'visual-asset-service\server.mjs'
    presentationAnalysis = Join-Path $external 'presentation-analysis-service\server.mjs'
    runtimeBridgeChrome = Join-Path $repoRoot '.codex-longrun\original-runtime-bridge-chrome-claude'
    startBatch = Join-Path $repoRoot 'Start.bat'
    sillyTavernHiddenLauncher = Join-Path $repoRoot 'external-modules\process-supervisor\launchers\StartGalgameServerHidden.cmd'
}

function Normalize-CommandLine([string]$value) {
    return ([string]$value).Replace('/', '\').ToLowerInvariant()
}

function Has-ExactPathArgument([string]$commandLine, [string]$fullPath) {
    $line = Normalize-CommandLine $commandLine
    $target = Normalize-CommandLine ([IO.Path]::GetFullPath($fullPath))
    $pattern = '(?:^|[\s"])' + [regex]::Escape($target) + '(?=$|[\s"])'
    return [regex]::IsMatch($line, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
}

function Has-RelativeServerEntryArgument([string]$commandLine) {
    return [regex]::IsMatch((Normalize-CommandLine $commandLine), '(?:^|[\s"])server\.js(?=$|[\s"])', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
}

if (-not ('GalgameNativeProcessQuery' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class GalgameNativeProcessQuery {
    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_BASIC_INFORMATION {
        public IntPtr Reserved1;
        public IntPtr PebBaseAddress;
        public IntPtr Reserved2_0;
        public IntPtr Reserved2_1;
        public IntPtr UniqueProcessId;
        public IntPtr InheritedFromUniqueProcessId;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct UNICODE_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }
    [DllImport("kernel32.dll", SetLastError=true)] private static extern IntPtr OpenProcess(uint access, bool inherit, int processId);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, IntPtr size, out IntPtr read);
    [DllImport("kernel32.dll", SetLastError=true, EntryPoint="IsWow64Process2")] private static extern bool IsWow64Process2(IntPtr process, out ushort processMachine, out ushort nativeMachine);
    [DllImport("ntdll.dll")] private static extern int NtQueryInformationProcess(IntPtr process, int infoClass, ref PROCESS_BASIC_INFORMATION info, int length, out int returned);
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint PROCESS_VM_READ = 0x0010;
    private const uint PROCESS_TERMINATE = 0x0001;
    private const uint SYNCHRONIZE = 0x00100000;
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder imageName, ref int size);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    private static byte[] Read(IntPtr process, IntPtr address, int count) {
        byte[] data = new byte[count]; IntPtr read;
        if (!ReadProcessMemory(process, address, data, new IntPtr(count), out read) || read.ToInt64() != count)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return data;
    }
    private static IntPtr ReadPointer(IntPtr process, IntPtr address) {
        byte[] data = Read(process, address, IntPtr.Size);
        return IntPtr.Size == 8 ? new IntPtr(BitConverter.ToInt64(data, 0)) : new IntPtr(BitConverter.ToInt32(data, 0));
    }
    public static bool IsSupportedMachine(ushort processMachine, ushort nativeMachine, int pointerSize) {
        const ushort IMAGE_FILE_MACHINE_UNKNOWN=0x0000, IMAGE_FILE_MACHINE_I386=0x014c, IMAGE_FILE_MACHINE_AMD64=0x8664;
        ushort actualMachine = processMachine == IMAGE_FILE_MACHINE_UNKNOWN ? nativeMachine : processMachine;
        return (pointerSize == 8 && actualMachine == IMAGE_FILE_MACHINE_AMD64)
            || (pointerSize == 4 && actualMachine == IMAGE_FILE_MACHINE_I386);
    }
    private static string ReadUnicodeString(IntPtr process, IntPtr address) {
        byte[] unicode = Read(process, address, IntPtr.Size == 8 ? 16 : 8);
        ushort length = BitConverter.ToUInt16(unicode, 0);
        IntPtr buffer = IntPtr.Size == 8 ? new IntPtr(BitConverter.ToInt64(unicode, 8)) : new IntPtr(BitConverter.ToInt32(unicode, 4));
        if (length == 0 || (length & 1) != 0 || buffer == IntPtr.Zero || length > 32766) throw new InvalidOperationException("Process Unicode field is invalid.");
        return System.Text.Encoding.Unicode.GetString(Read(process, buffer, length));
    }
    public static GalgameProcessLease OpenIdentity(int processId) {
        if (Environment.Is64BitOperatingSystem && !Environment.Is64BitProcess)
            throw new NotSupportedException("A 32-bit query host cannot prove the target native process layout.");
        IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ | PROCESS_TERMINATE | SYNCHRONIZE, false, processId);
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            ushort processMachine, nativeMachine;
            if (!IsWow64Process2(process, out processMachine, out nativeMachine)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!IsSupportedMachine(processMachine, nativeMachine, IntPtr.Size)) throw new NotSupportedException("Unsupported process/native machine layout.");
            PROCESS_BASIC_INFORMATION info = new PROCESS_BASIC_INFORMATION(); int returned;
            int status = NtQueryInformationProcess(process, 0, ref info, Marshal.SizeOf(typeof(PROCESS_BASIC_INFORMATION)), out returned);
            if (status != 0 || info.PebBaseAddress == IntPtr.Zero || info.UniqueProcessId.ToInt32() != processId) throw new InvalidOperationException("PEB identity query failed.");
            long pebParametersOffset = IntPtr.Size == 8 ? 0x20 : 0x10;
            long currentDirectoryOffset = IntPtr.Size == 8 ? 0x38 : 0x24;
            long imagePathOffset = IntPtr.Size == 8 ? 0x60 : 0x38;
            long commandLineOffset = IntPtr.Size == 8 ? 0x70 : 0x40;
            IntPtr parameters = ReadPointer(process, IntPtr.Add(info.PebBaseAddress, (int)pebParametersOffset));
            if (parameters == IntPtr.Zero) throw new InvalidOperationException("Process parameters are unavailable.");
            string currentDirectory = ReadUnicodeString(process, IntPtr.Add(parameters, (int)currentDirectoryOffset));
            string imagePath = ReadUnicodeString(process, IntPtr.Add(parameters, (int)imagePathOffset));
            string commandLine = ReadUnicodeString(process, IntPtr.Add(parameters, (int)commandLineOffset));
            long creation, exit, kernel, user;
            if (!GetProcessTimes(process, out creation, out exit, out kernel, out user)) throw new Win32Exception(Marshal.GetLastWin32Error());
            StringBuilder imageName = new StringBuilder(32768); int imageNameLength = imageName.Capacity;
            if (!QueryFullProcessImageName(process, 0, imageName, ref imageNameLength)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return new GalgameProcessLease(process, processId, currentDirectory, imagePath, commandLine, imageName.ToString(), creation);
        } catch { CloseHandle(process); throw; }
    }
    public static bool TerminateVerifiedHandle(IntPtr handle) { return TerminateProcess(handle, 1); }
    public static uint WaitForVerifiedHandle(IntPtr handle, uint milliseconds) { return WaitForSingleObject(handle, milliseconds); }
    public static bool MatchesVerifiedIdentity(IntPtr process, int processId, string expectedCurrentDirectory, string expectedImagePath, string expectedCommandLine, string expectedQueriedImagePath, long expectedCreation) {
        ushort processMachine, nativeMachine;
        if (!IsWow64Process2(process, out processMachine, out nativeMachine) || !IsSupportedMachine(processMachine, nativeMachine, IntPtr.Size)) return false;
        PROCESS_BASIC_INFORMATION info = new PROCESS_BASIC_INFORMATION(); int returned;
        int status = NtQueryInformationProcess(process, 0, ref info, Marshal.SizeOf(typeof(PROCESS_BASIC_INFORMATION)), out returned);
        if (status != 0 || info.PebBaseAddress == IntPtr.Zero || info.UniqueProcessId.ToInt32() != processId) return false;
        long pebParametersOffset = IntPtr.Size == 8 ? 0x20 : 0x10;
        long currentDirectoryOffset = IntPtr.Size == 8 ? 0x38 : 0x24;
        long imagePathOffset = IntPtr.Size == 8 ? 0x60 : 0x38;
        long commandLineOffset = IntPtr.Size == 8 ? 0x70 : 0x40;
        IntPtr parameters = ReadPointer(process, IntPtr.Add(info.PebBaseAddress, (int)pebParametersOffset));
        if (parameters == IntPtr.Zero) return false;
        string currentDirectory = ReadUnicodeString(process, IntPtr.Add(parameters, (int)currentDirectoryOffset));
        string imagePath = ReadUnicodeString(process, IntPtr.Add(parameters, (int)imagePathOffset));
        string commandLine = ReadUnicodeString(process, IntPtr.Add(parameters, (int)commandLineOffset));
        long creation, exit, kernel, user;
        if (!GetProcessTimes(process, out creation, out exit, out kernel, out user)) throw new Win32Exception(Marshal.GetLastWin32Error());
        StringBuilder imageName = new StringBuilder(32768); int imageNameLength = imageName.Capacity;
        if (!QueryFullProcessImageName(process, 0, imageName, ref imageNameLength)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return currentDirectory == expectedCurrentDirectory && imagePath == expectedImagePath && commandLine == expectedCommandLine
            && imageName.ToString() == expectedQueriedImagePath && creation == expectedCreation;
    }
    public static void CloseVerifiedHandle(IntPtr handle) { CloseHandle(handle); }
}
public sealed class GalgameProcessLease : IDisposable {
    public IntPtr Handle { get; private set; }
    public int ProcessId { get; private set; }
    public string CurrentDirectory { get; private set; }
    public string ImagePath { get; private set; }
    public string CommandLine { get; private set; }
    public string QueriedImagePath { get; private set; }
    public long CreationFileTime { get; private set; }
    public GalgameProcessLease(IntPtr handle, int pid, string cwd, string imagePath, string commandLine, string queriedImagePath, long creation) {
        Handle=handle; ProcessId=pid; CurrentDirectory=cwd; ImagePath=imagePath; CommandLine=commandLine; QueriedImagePath=queriedImagePath; CreationFileTime=creation;
    }
    public void Terminate() {
        if (Handle == IntPtr.Zero) throw new ObjectDisposedException("GalgameProcessLease");
        if (!GalgameNativeProcessQuery.MatchesVerifiedIdentity(Handle, ProcessId, CurrentDirectory, ImagePath, CommandLine, QueriedImagePath, CreationFileTime))
            throw new InvalidOperationException("Verified process identity changed before termination. PID=" + ProcessId);
        if (!GalgameNativeProcessQuery.TerminateVerifiedHandle(Handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
        uint wait = GalgameNativeProcessQuery.WaitForVerifiedHandle(Handle, 10000);
        if (wait == 0) return;
        if (wait == 258) throw new TimeoutException("Verified process wait timed out (WAIT_TIMEOUT). PID=" + ProcessId);
        if (wait == 0xffffffff) { int error = Marshal.GetLastWin32Error(); throw new Win32Exception(error, "Verified process wait failed (WAIT_FAILED). PID=" + ProcessId + " Win32=" + error); }
        throw new InvalidOperationException("Verified process wait returned unexpected code " + wait + ". PID=" + ProcessId);
    }
    public void Dispose() { if (Handle != IntPtr.Zero) { GalgameNativeProcessQuery.CloseVerifiedHandle(Handle); Handle=IntPtr.Zero; } }
}
'@
}

if (-not ('GalgameCommandLine' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GalgameCommandLine {
    [DllImport("shell32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr CommandLineToArgvW(string commandLine, out int count);
    [DllImport("kernel32.dll")] public static extern IntPtr LocalFree(IntPtr memory);
}
'@
}

function Get-CommandLineArguments([string]$commandLine) {
    if ([string]::IsNullOrWhiteSpace($commandLine)) { return @() }
    $count = 0
    $memory = [GalgameCommandLine]::CommandLineToArgvW($commandLine, [ref]$count)
    if ($memory -eq [IntPtr]::Zero) { throw 'COMMAND_LINE_PARSE_FAILED' }
    try {
        $args = @()
        for ($index = 0; $index -lt $count; $index++) {
            $item = [Runtime.InteropServices.Marshal]::ReadIntPtr($memory, $index * [IntPtr]::Size)
            $args += [Runtime.InteropServices.Marshal]::PtrToStringUni($item)
        }
        return $args
    } finally { [void][GalgameCommandLine]::LocalFree($memory) }
}

function Test-StrictNodeScriptEntry($item, [string]$scriptPath) {
    try { $args = @(Get-CommandLineArguments ([string]$item.CommandLine)) } catch { return $false }
    if ($args.Count -lt 2 -or $args.Count -gt 3) { return $false }
    $exe = Normalize-CommandLine ([IO.Path]::GetFullPath([string]$item.ExecutablePath))
    $firstArgument = Normalize-CommandLine ([string]$args[0])
    if ($firstArgument -ne $exe -and [IO.Path]::GetFileName($firstArgument) -ine 'node.exe') { return $false }
    if ($args.Count -eq 3) {
        if ([IO.Path]::GetFileName($firstArgument) -ine 'node.exe') { return $false }
        if ((Normalize-CommandLine ([string]$args[1])) -ne $exe) { return $false }
        $entry = [string]$args[2]
    } else { $entry = [string]$args[1] }
    $normalizedEntry = Normalize-CommandLine $entry
    $expected = Normalize-CommandLine ([IO.Path]::GetFullPath($scriptPath))
    if ($normalizedEntry -eq $expected) { return 'absolute' }
    if ($scriptPath -ieq $targets.sillyTavern -and $entry -ceq 'server.js') { return 'relative' }
    return $false
}

function Normalize-Directory([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { throw 'EMPTY_CWD' }
    $normalized = $value.Replace('/', '\')
    if ($normalized.StartsWith('\\?\')) { $normalized = $normalized.Substring(4) }
    if ($normalized.StartsWith('\??\')) { $normalized = $normalized.Substring(4) }
    return [IO.Path]::GetFullPath($normalized).TrimEnd('\')
}

function Get-ParentState($item, $parents, $fixtureMode = $false) {
    if ($fixtureMode -and $null -ne $item.parentAvailable -and $null -ne $item.parentQuerySucceeded) {
        return @{ available = [bool]$item.parentAvailable; item = $null; querySucceeded = [bool]$item.parentQuerySucceeded }
    }
    $parentId = [int]$item.ParentProcessId
    if ($parents.ContainsKey($parentId)) { return @{ available = $true; item = $parents[$parentId]; querySucceeded = $true } }
    try {
        $parent = [Diagnostics.Process]::GetProcessById($parentId)
        try { return @{ available = $true; item = $null; querySucceeded = $true } } finally { $parent.Dispose() }
    } catch [ArgumentException] { return @{ available = $false; item = $null; querySucceeded = $true } }
      catch { return @{ available = $true; item = $null; querySucceeded = $false } }
}

function Get-CurrentDirectoryQuery($item, $fixture) {
    if ($fixture) {
        if ($fixture.forceCurrentDirectoryQueryFailure -eq $true) { return @{ succeeded = $false; directory = ''; identity = $null } }
        if ($fixture.forceUnsupportedArchitecture -eq $true) {
            $supported = [GalgameNativeProcessQuery]::IsSupportedMachine([uint16]$fixture.processMachine, [uint16]$fixture.nativeMachine, [IntPtr]::Size)
            if (-not $supported) { return @{ succeeded = $false; directory = ''; identity = $null; reason = 'UNSUPPORTED_PROCESS_ARCHITECTURE' } }
        }
    }
    $identity = $null
    try {
        $identity = [GalgameNativeProcessQuery]::OpenIdentity([int]$item.ProcessId)
        $expectedImage = ([string]$item.ExecutablePath).Replace('/', '\').TrimEnd('\')
        $queriedImage = ([string]$identity.QueriedImagePath).Replace('/', '\').TrimEnd('\')
        $expectedCreation = ([datetime]$item.CreationDate).ToUniversalTime().ToFileTimeUtc()
        if (($identity.ProcessId -ne [int]$item.ProcessId) -or ($expectedImage -ine $queriedImage) -or ([string]$identity.CommandLine -cne [string]$item.CommandLine) -or ([Math]::Abs($identity.CreationFileTime - $expectedCreation) -gt 10)) {
            $identity.Dispose()
            return @{ succeeded = $false; directory = ''; identity = $null; reason = 'PROCESS_IDENTITY_CHANGED' }
        }
        return @{ succeeded = $true; directory = [string]$identity.CurrentDirectory; identity = $identity; reason = '' }
    } catch {
        $reason = if ($fixture) { $_.Exception.ToString() } else { $_.Exception.GetType().Name }
        if ($identity) { $identity.Dispose() }
        return @{ succeeded = $false; directory = ''; identity = $null; reason = $reason }
    }
}

function Add-VerifiedProcessCandidate($matches, [string]$service, $item, [switch]$RequireRepositoryDirectory, [switch]$FixtureMode) {
    if (@($matches[$service] | Where-Object { [int]$_.ProcessId -eq [int]$item.ProcessId }).Count -gt 0) { return $true }
    $fixture = if ($FixtureMode) { $item } else { $null }
    $verified = Get-CurrentDirectoryQuery $item $fixture
    $reason = ''
    if (-not $verified.succeeded) { $reason = if ($verified.reason) { [string]$verified.reason } else { 'PROCESS_IDENTITY_UNVERIFIABLE' } }
    elseif ($RequireRepositoryDirectory -and (Normalize-Directory $verified.directory) -cne (Normalize-Directory $repoRoot)) {
        if ($verified.identity) { $verified.identity.Dispose() }
        $matches["${service}OutOfRepo"] += @($item)
        return $false
    }
    if ($reason) {
        if ($verified.identity) { $verified.identity.Dispose() }
        $matches["${service}Ambiguous"] += @(@{ item = $item; reason = $reason })
        return $false
    }
    $item | Add-Member -NotePropertyName GalgameVerifiedHandle -NotePropertyValue $verified.identity -Force
    if (-not @($matches[$service] | Where-Object { [int]$_.ProcessId -eq [int]$item.ProcessId }).Count) {
        $matches[$service] += @($item)
    }
    return $true
}

function Test-AllowedLauncherCommandLine([string]$commandLine, [string]$executablePath, [string[]]$allowedPaths) {
    if ([string]::IsNullOrWhiteSpace($commandLine) -or [string]::IsNullOrWhiteSpace($executablePath)) { return $false }
    $line = Normalize-CommandLine $commandLine
    $exe = Normalize-CommandLine ([IO.Path]::GetFullPath($executablePath))
    $exePattern = '(?:"' + [regex]::Escape($exe) + '"|' + [regex]::Escape($exe) + ')'
    foreach ($allowedPath in $allowedPaths) {
        $target = Normalize-CommandLine ([IO.Path]::GetFullPath($allowedPath))
        $targetPattern = [regex]::Escape($target)
        # Accept only a complete /c command that directly executes the registered
        # batch file. The hidden wrapper must carry its exact private child sentinel.
        $directPattern = '^\s*' + $exePattern + '\s+(?:[/\\]d\s+)?[/\\]c\s+"' + $targetPattern + '"\s*$'
        if ([regex]::IsMatch($line, $directPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)) { return $true }
        if ($target -ieq (Normalize-CommandLine ([IO.Path]::GetFullPath($targets.sillyTavernHiddenLauncher)))) {
            $hiddenPattern = '^\s*' + $exePattern + '\s+(?:[/\\]d\s+)?[/\\]c\s+""' + $targetPattern + '"\s+--galgame-hidden-child"\s*$'
            if ([regex]::IsMatch($line, $hiddenPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)) { return $true }
        }
    }
    return $false
}

function Test-AllowedLauncherCandidate([string]$commandLine, [string]$executablePath, [string[]]$allowedPaths, [string]$currentDirectory) {
    if (-not (Test-AllowedLauncherCommandLine $commandLine $executablePath $allowedPaths)) { return $false }
    try { return (Normalize-Directory $currentDirectory) -ceq (Normalize-Directory $repoRoot) }
    catch { return $false }
}

function Test-ExactLauncherCommand($item, [string[]]$allowedPaths) {
    if ($item.Name -ine 'cmd.exe') { return $false }
    $directory = Get-CurrentDirectoryQuery $item $null
    if (-not $directory.succeeded) { return $false }
    try { return Test-AllowedLauncherCandidate ([string]$item.CommandLine) ([string]$item.ExecutablePath) $allowedPaths ([string]$directory.directory) }
    finally { if ($directory.identity) { $directory.identity.Dispose() } }
}

function Test-ExactChromeProfileArguments($item, [string]$profilePath) {
    try { $args = @(Get-CommandLineArguments ([string]$item.CommandLine)) } catch { return $false }
    $target = Normalize-CommandLine ([IO.Path]::GetFullPath($profilePath))
    for ($index = 1; $index -lt $args.Count; $index++) {
        $arg = [string]$args[$index]
        if ($arg.StartsWith('--user-data-dir=', [StringComparison]::OrdinalIgnoreCase)) {
            if ((Normalize-CommandLine $arg.Substring('--user-data-dir='.Length)).Trim('"') -eq $target) { return $true }
        }
        if ($arg -ieq '--user-data-dir' -and $index + 1 -lt $args.Count) {
            if ((Normalize-CommandLine ([string]$args[$index + 1])).Trim('"') -eq $target) { return $true }
        }
    }
    return $false
}

function Has-ExactChromeProfile([string]$commandLine, [string]$profilePath) {
    $line = Normalize-CommandLine $commandLine
    $target = Normalize-CommandLine ([IO.Path]::GetFullPath($profilePath))
    $pattern = '(?:^|\s)--user-data-dir(?:=|\s+)"?' + [regex]::Escape($target) + '"?(?=$|\s)'
    return [regex]::IsMatch($line, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
}

function Get-ServiceMatches($snapshot, $fixtureMode = $false, $listenerSnapshot = @(), $listenerQuerySucceeded = $true) {
    $parents = @{}
    foreach ($item in $snapshot) { $parents[[int]$item.ProcessId] = $item }
    $matches = [ordered]@{}
    foreach ($service in @('sillyTavernNode','sillyTavernLauncher','configService','runtimeBridge','visualService','presentationAnalysis','runtimeBridgeChrome')) {
        $matches[$service] = @()
        $matches["${service}Ambiguous"] = @()
        $matches["${service}OutOfRepo"] = @()
    }
    foreach ($service in $servicePorts.Keys) { $matches["${service}PortAmbiguous"] = @() }
    foreach ($item in $snapshot) {
        if ($item.Name -ieq 'node.exe') {
            $recognized = $false
            foreach ($service in @('sillyTavern','configService','runtimeBridge','visualService','presentationAnalysis')) {
                $targetEntry = if ($service -eq 'sillyTavern') { $targets.sillyTavern } else { $targets[$service] }
                $entryKind = Test-StrictNodeScriptEntry $item $targetEntry
                if (-not $entryKind) { continue }
                $recognized = $true
                if ($service -eq 'sillyTavern' -and $entryKind -eq 'relative') {
                    $parentState = Get-ParentState $item $parents $fixtureMode
                    $parent = $parentState.item
                    if ($parent -and $parent.Name -ieq 'cmd.exe' -and (Test-ExactLauncherCommand $parent @($targets.startBatch,$targets.sillyTavernHiddenLauncher))) {
                        [void](Add-VerifiedProcessCandidate $matches 'sillyTavernNode' $item -FixtureMode:$fixtureMode)
                        [void](Add-VerifiedProcessCandidate $matches 'sillyTavernLauncher' $parent -FixtureMode:$fixtureMode)
                    } elseif (-not $parentState.querySucceeded -or $parentState.available) {
                        $matches.sillyTavernNodeAmbiguous += @(@{ item = $item; reason = 'PARENT_IDENTITY_AMBIGUOUS' })
                    } else {
                        [void](Add-VerifiedProcessCandidate $matches 'sillyTavernNode' $item -RequireRepositoryDirectory -FixtureMode:$fixtureMode)
                    }
                } elseif ($service -eq 'sillyTavern') {
                    [void](Add-VerifiedProcessCandidate $matches 'sillyTavernNode' $item -FixtureMode:$fixtureMode)
                } else {
                    [void](Add-VerifiedProcessCandidate $matches $service $item -FixtureMode:$fixtureMode)
                }
                break
            }
            if ($recognized) { continue }
        }
        if ($item.Name -ieq 'chrome.exe' -and (Test-ExactChromeProfileArguments $item $targets.runtimeBridgeChrome)) {
            [void](Add-VerifiedProcessCandidate $matches 'runtimeBridgeChrome' $item -FixtureMode:$fixtureMode)
            continue
        }
        if ($item.Name -ieq 'cmd.exe' -and (Test-ExactLauncherCommand $item @($targets.startBatch,$targets.sillyTavernHiddenLauncher))) {
            [void](Add-VerifiedProcessCandidate $matches 'sillyTavernLauncher' $item -FixtureMode:$fixtureMode)
        }
    }
    foreach ($service in $servicePorts.Keys) {
        if (-not $listenerQuerySucceeded) {
            $matches["${service}PortAmbiguous"] += @(@{ reason = 'SERVICE_PORT_LISTENER_QUERY_FAILED' })
            continue
        }
        foreach ($listener in @($listenerSnapshot | Where-Object { [int]$_.LocalPort -eq [int]$servicePorts[$service] })) {
            $ownerId = [int]$listener.OwningProcess
            $candidateKeys = switch ($service) {
                'sillyTavern' { @('sillyTavernNode','sillyTavernLauncher') }
                default { @($service) }
            }
            $verifiedOwner = $false
            foreach ($key in $candidateKeys) {
                if (@($matches[$key] | Where-Object { [int]$_.ProcessId -eq $ownerId }).Count -gt 0) { $verifiedOwner = $true; break }
            }
            if (-not $verifiedOwner) {
                $matches["${service}PortAmbiguous"] += @(@{ reason = 'PORT_OWNER_PROCESS_IDENTITY_UNVERIFIED' })
            }
        }
    }
    return $matches
}

function Close-ServiceMatchHandles($serviceMatches) {
    foreach ($key in @('sillyTavernNode','sillyTavernLauncher','configService','runtimeBridge','visualService','presentationAnalysis','runtimeBridgeChrome')) {
        foreach ($item in @($serviceMatches[$key])) {
            if ($item.GalgameVerifiedHandle) {
                $item.GalgameVerifiedHandle.Dispose()
                $item.GalgameVerifiedHandle = $null
            }
        }
    }
}

if ($TestLauncherCommandParser) {
    $matched = Test-AllowedLauncherCandidate $TestCommandLine $TestExecutablePath @($targets.startBatch,$targets.sillyTavernHiddenLauncher) $TestCurrentDirectory
    [Console]::Out.WriteLine(($matched | ConvertTo-Json -Compress))
    exit 0
}

try {
    if ($FixturePath) {
        $before = @($fixture.processes)
        foreach ($item in $before) { if (-not $item.ExecutablePath) { $item | Add-Member -NotePropertyName ExecutablePath -NotePropertyValue '' -Force } }
        $selected = Get-ServiceMatches $before $true @($fixture.portListeners) ($fixture.portListenerQuerySucceeded -ne $false)
    } else {
        $before = @(Get-CimInstance Win32_Process -ErrorAction Stop)
        try { $listenerSnapshot = @(Get-NetTCPConnection -State Listen -ErrorAction Stop); $listenerQuerySucceeded = $true }
        catch { $listenerSnapshot = @(); $listenerQuerySucceeded = $false }
        $selected = Get-ServiceMatches $before $false $listenerSnapshot $listenerQuerySucceeded
    }
    $targetsByService = [ordered]@{
        sillyTavern = @($selected.sillyTavernNode) + @($selected.sillyTavernLauncher)
        configService = @($selected.configService)
        runtimeBridge = @($selected.runtimeBridge)
        visualService = @($selected.visualService)
        presentationAnalysis = @($selected.presentationAnalysis)
        runtimeBridgeChrome = @($selected.runtimeBridgeChrome)
    }
    if (-not $Preview) {
        foreach ($service in $targetsByService.Keys) {
            foreach ($item in $targetsByService[$service]) {
                if (-not $item.GalgameVerifiedHandle) { throw 'TARGET_PROCESS_HANDLE_UNVERIFIED' }
                $item.GalgameVerifiedHandle.Terminate()
                $item.GalgameVerifiedHandle.Dispose()
                $item.GalgameVerifiedHandle = $null
            }
        }
        Start-Sleep -Milliseconds 300
        if ($FixturePath) {
            # Fixture termination stays isolated from the host's real process and port inventory.
            $remaining = Get-ServiceMatches @() $true @($fixture.portListeners) ($fixture.portListenerQuerySucceeded -ne $false)
        } else {
            $after = @(Get-CimInstance Win32_Process -ErrorAction Stop)
            try { $remainingListenerSnapshot = @(Get-NetTCPConnection -State Listen -ErrorAction Stop); $remainingListenerQuerySucceeded = $true }
            catch { $remainingListenerSnapshot = @(); $remainingListenerQuerySucceeded = $false }
            $remaining = Get-ServiceMatches $after $false $remainingListenerSnapshot $remainingListenerQuerySucceeded
        }
    } else {
        $remaining = $selected
    }
    $confirmed = [ordered]@{
        sillyTavern = (@($remaining.sillyTavernNode).Count + @($remaining.sillyTavernLauncher).Count + @($remaining.sillyTavernNodeAmbiguous).Count + @($remaining.sillyTavernLauncherAmbiguous).Count + @($remaining.sillyTavernPortAmbiguous).Count) -eq 0
        configService = (@($remaining.configService).Count + @($remaining.configServiceAmbiguous).Count + @($remaining.configServicePortAmbiguous).Count) -eq 0
        runtimeBridge = (@($remaining.runtimeBridge).Count + @($remaining.runtimeBridgeAmbiguous).Count + @($remaining.runtimeBridgePortAmbiguous).Count) -eq 0
        visualService = (@($remaining.visualService).Count + @($remaining.visualServiceAmbiguous).Count + @($remaining.visualServicePortAmbiguous).Count) -eq 0
        presentationAnalysis = (@($remaining.presentationAnalysis).Count + @($remaining.presentationAnalysisAmbiguous).Count + @($remaining.presentationAnalysisPortAmbiguous).Count) -eq 0
        runtimeBridgeChrome = (@($remaining.runtimeBridgeChrome).Count + @($remaining.runtimeBridgeChromeAmbiguous).Count) -eq 0
    }
    $results = [ordered]@{}
    foreach ($service in $targetsByService.Keys) {
        $initialCount = @($targetsByService[$service]).Count
        if ($service -eq 'sillyTavern') { $ambiguousKeys = @('sillyTavernNodeAmbiguous','sillyTavernLauncherAmbiguous','sillyTavernPortAmbiguous') }
        elseif ($servicePorts.Contains($service)) { $ambiguousKeys = @("${service}Ambiguous", "${service}PortAmbiguous") }
        else { $ambiguousKeys = @("${service}Ambiguous") }
        $ambiguousCount = 0
        foreach ($key in $ambiguousKeys) { $ambiguousCount += @($selected[$key]).Count; if (-not $Preview) { $ambiguousCount += @($remaining[$key]).Count } }
        $stillRunningCount = if ($service -eq 'sillyTavern') { @($remaining.sillyTavernNode).Count + @($remaining.sillyTavernLauncher).Count + @($remaining.sillyTavernPortAmbiguous).Count } else { @($remaining[$service]).Count + @($remaining["${service}PortAmbiguous"]).Count }
        $status = if ($ambiguousCount -gt 0) { 'failed' } elseif ($Preview -and $initialCount -gt 0) { 'would-stop' } elseif ($Preview) { 'already-stopped' } elseif ($confirmed[$service]) { if ($initialCount -gt 0) { 'stopped' } else { 'already-stopped' } } else { 'failed' }
        $entry = @{ status = $status; stoppedCount = if ($Preview) { 0 } elseif ($confirmed[$service]) { $initialCount } else { 0 }; remainingCount = if ($confirmed[$service] -and -not $Preview) { 0 } else { $stillRunningCount } }
        if ($ambiguousCount -gt 0) {
            $entry.errorCode = 'PROCESS_IDENTITY_AMBIGUOUS'
            $entry.ambiguousReasons = @($ambiguousKeys | ForEach-Object { @($selected[$_]) + $(if (-not $Preview) { @($remaining[$_]) } else { @() }) } | ForEach-Object { $_.reason } | Select-Object -Unique)
        }
        if ($service -eq 'sillyTavern') {
            $entry.ambiguousCount = $ambiguousCount
            $entry.repoCurrentDirectoryMatchCount = @($selected.sillyTavernNode | Where-Object { (Test-StrictNodeScriptEntry $_ $targets.sillyTavern) -eq 'relative' }).Count
        }
        $results[$service] = $entry
    }
    $results.processSupervisor = @{ status = 'kept-running'; stoppedCount = 0; remainingCount = 1 }
    $allStopped = @($results.Values | Where-Object { $_.status -in @('failed', 'partially-stopped') }).Count -eq 0
    if ($Preview -and @($results.Values | Where-Object { $_.status -eq 'failed' }).Count -gt 0) { $allStopped = $false }
    $envelope = @{ ok = $allStopped; operationId = $env:GALGAME_SHUTDOWN_OPERATION_ID; services = $results }
    Close-ServiceMatchHandles $selected
    if (-not $Preview) { Close-ServiceMatchHandles $remaining }
    $envelope | ConvertTo-Json -Depth 8 -Compress
    if (-not $allStopped) { exit 2 }
}
catch {
    if ($selected) { Close-ServiceMatchHandles $selected }
    if ($remaining -and -not $Preview) { Close-ServiceMatchHandles $remaining }
    if ($FixturePath) { [Console]::Error.WriteLine(('FIXTURE_FAILURE: ' + $_.Exception.ToString())) }
    else { [Console]::Error.WriteLine('SHUTDOWN_PROCESS_QUERY_OR_TERMINATION_FAILED') }
    exit 1
}
