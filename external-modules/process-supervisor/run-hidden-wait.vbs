Option Explicit
Dim shell, commandLine, executablePath, i, argument, exitCode
If WScript.Arguments.Count < 1 Then WScript.Quit 2
executablePath = WScript.Arguments(0)
commandLine = QuoteArgument(executablePath)
For i = 1 To WScript.Arguments.Count - 1
    argument = WScript.Arguments(i)
    commandLine = commandLine & " " & QuoteArgument(argument)
Next
Set shell = CreateObject("WScript.Shell")
exitCode = shell.Run(commandLine, 0, True)
WScript.Quit exitCode

Function QuoteArgument(value)
    Dim result, slashCount, index, character
    result = Chr(34)
    slashCount = 0
    For index = 1 To Len(value)
        character = Mid(value, index, 1)
        If character = Chr(92) Then
            slashCount = slashCount + 1
        ElseIf character = Chr(34) Then
            result = result & String((slashCount * 2) + 1, Chr(92)) & Chr(34)
            slashCount = 0
        Else
            result = result & String(slashCount, Chr(92)) & character
            slashCount = 0
        End If
    Next
    result = result & String(slashCount * 2, Chr(92)) & Chr(34)
    QuoteArgument = result
End Function
