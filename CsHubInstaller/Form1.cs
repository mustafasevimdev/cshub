using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Diagnostics;

namespace CsHubInstaller
{
    public partial class Form1 : Form
    {
        public Form1()
        {
            InitializeComponent();
        }

        private async void Form1_Load(object sender, EventArgs e)
        {
            await Task.Run(() => InstallApp());
        }

        private void InstallApp()
        {
            try
            {
                UpdateStatus("Eski sürüm kapatılıyor...");
                foreach (var process in Process.GetProcessesByName("cshub"))
                {
                    try 
                    {
                        process.Kill();
                        process.WaitForExit(3000);
                    } 
                    catch { }
                }

                UpdateStatus("Dosyalar kopyalanıyor...");
                
                string appDataFolder = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string installDir = Path.Combine(appDataFolder, "CsHub");

                if (Directory.Exists(installDir))
                {
                    try {
                        // Recursively remove readonly attributes before deleting
                        foreach (string file in Directory.GetFiles(installDir, "*", SearchOption.AllDirectories))
                        {
                            File.SetAttributes(file, FileAttributes.Normal);
                        }
                        Directory.Delete(installDir, true);
                    } catch { } // If delete fails, proceed to overwrite
                }
                Directory.CreateDirectory(installDir);

                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("CsHubInstaller.app.zip"))
                {
                    if (stream == null) throw new Exception("Kurulum dosyası bulunamadı.");
                    using (ZipArchive archive = new ZipArchive(stream))
                    {
                        int total = archive.Entries.Count;
                        int current = 0;
                        foreach (ZipArchiveEntry entry in archive.Entries)
                        {
                            string destinationPath = Path.GetFullPath(Path.Combine(installDir, entry.FullName));
                            if (destinationPath.StartsWith(installDir, StringComparison.Ordinal))
                            {
                                if (entry.FullName.EndsWith("/"))
                                {
                                    Directory.CreateDirectory(destinationPath);
                                }
                                else
                                {
                                    Directory.CreateDirectory(Path.GetDirectoryName(destinationPath));
                                    entry.ExtractToFile(destinationPath, true);
                                }
                            }
                            current++;
                            UpdateProgress((int)((current / (double)total) * 90)); // first 90% is extraction
                        }
                    }
                }

                UpdateStatus("Kısayollar oluşturuluyor...");
                string exePath = Path.Combine(installDir, "cshub.exe");
                string iconPath = Path.Combine(installDir, "logo.ico");
                try {
                    using (Stream iconStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("CsHubInstaller.logo.ico"))
                    {
                        if (iconStream != null)
                        {
                            using (FileStream fs = new FileStream(iconPath, FileMode.Create))
                            {
                                iconStream.CopyTo(fs);
                            }
                        }
                    }
                } catch { }
                CreateShortcut(exePath, iconPath);

                UpdateProgress(100);
                UpdateStatus("Kurulum tamamlandı! Uygulama başlatılıyor...");
                
                Task.Delay(1000).Wait();
                Process.Start(new ProcessStartInfo(exePath) { UseShellExecute = true });
                
                this.Invoke(new Action(() => this.Close()));
            }
            catch (Exception ex)
            {
                MessageBox.Show("Kurulum sırasında hata oluştu:\n" + ex.Message, "Hata", MessageBoxButtons.OK, MessageBoxIcon.Error);
                this.Invoke(new Action(() => this.Close()));
            }
        }

        private void CreateShortcut(string targetPath, string iconPath)
        {
            string desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string startMenuDir = Environment.GetFolderPath(Environment.SpecialFolder.StartMenu);
            string shortcutPathDesktop = Path.Combine(desktopDir, "CsHub.lnk");
            string shortcutPathStartMenu = Path.Combine(startMenuDir, "Programs", "CsHub.lnk");
            
            // Create shortcut using WScript.Shell via late binding to avoid COM reference dependency
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            if (t != null)
            {
                dynamic shell = Activator.CreateInstance(t);
                
                dynamic shortcutDesktop = shell.CreateShortcut(shortcutPathDesktop);
                shortcutDesktop.TargetPath = targetPath;
                shortcutDesktop.WorkingDirectory = Path.GetDirectoryName(targetPath);
                shortcutDesktop.IconLocation = File.Exists(iconPath) ? iconPath : targetPath + ",0";
                shortcutDesktop.Save();

                try {
                	Directory.CreateDirectory(Path.GetDirectoryName(shortcutPathStartMenu));
                    dynamic shortcutStart = shell.CreateShortcut(shortcutPathStartMenu);
                    shortcutStart.TargetPath = targetPath;
                    shortcutStart.WorkingDirectory = Path.GetDirectoryName(targetPath);
                    shortcutStart.IconLocation = File.Exists(iconPath) ? iconPath : targetPath + ",0";
                    shortcutStart.Save();
                } catch { } // Ignore if start menu shortcut fails
            }
        }

        private void UpdateProgress(int percentage)
        {
            if (this.InvokeRequired)
            {
                this.Invoke(new Action(() => progressBar1.Value = percentage));
            }
            else
            {
                progressBar1.Value = percentage;
            }
        }

        private void UpdateStatus(string message)
        {
            if (this.InvokeRequired)
            {
                this.Invoke(new Action(() => lblStatus.Text = message));
            }
            else
            {
                lblStatus.Text = message;
            }
        }
    }
}
