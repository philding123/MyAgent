// MyAgentShareTarget forwarder (F24). Compiled at register time by
// register.ps1 with the .NET Framework bundler (csc.exe ships with Windows —
// no Visual Studio needed). Activation contract: the shell launches this exe
// with the shared item(s) on the command line; we take the first existing
// path and hand it to MyAgent via launch.ini:
//   line 1: working directory
//   line 2: executable path
//   line 3: argument template containing {file}
// The ini is looked up next to the exe AND in %ALLUSERSPROFILE%\MyAgent\ —
// sparse-package activation may run the exe from the WindowsApps payload
// root, where no sibling ini exists (register.ps1 writes both).
using System;
using System.Diagnostics;
using System.IO;

static class Forwarder
{
    [STAThread]
    static int Main(string[] args)
    {
        string file = null;
        foreach (string a in args)
        {
            if (a == null || a.StartsWith("-")) continue;
            if (File.Exists(a)) { file = a; break; }
        }
        string ini = FindIni();
        if (file == null || ini == null) return 2;
        try
        {
            string[] lines = File.ReadAllLines(ini);
            if (lines.Length < 3) return 2;
            var psi = new ProcessStartInfo
            {
                WorkingDirectory = lines[0].Trim(),
                FileName = lines[1].Trim(),
                Arguments = lines[2].Trim().Replace("{file}", file),
                UseShellExecute = true,
            };
            Process.Start(psi);
            return 0;
        }
        catch
        {
            return 1;
        }
    }

    static string FindIni()
    {
        string beside = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "launch.ini");
        if (File.Exists(beside)) return beside;
        string programData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "MyAgent", "launch.ini");
        return File.Exists(programData) ? programData : null;
    }
}
