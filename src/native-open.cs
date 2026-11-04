using System;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class NativeOpen {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 private struct ShellInfo {
  public int Size; public uint Mask; public IntPtr Window;
  public string Verb, File, Parameters, Directory; public int Show; public IntPtr Instance;
  public IntPtr IdList; public string Class; public IntPtr ClassKey; public uint HotKey;
  public IntPtr Icon, Process;
 }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 private struct OpenInfo {public string File, Class;public uint Flags;}
 [DllImport("shell32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 private static extern bool ShellExecuteEx(ref ShellInfo info);
 [DllImport("shell32.dll",CharSet=CharSet.Unicode,ExactSpelling=true)]
 private static extern int SHOpenWithDialog(IntPtr parent,ref OpenInfo info);
 [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
 private static void Pump(){var timer=Stopwatch.StartNew();while(timer.ElapsedMilliseconds<2000){Application.DoEvents();Thread.Sleep(20);}}
 [STAThread] private static int Main(string[] args){
  if(args.Length==1&&args[0]=="--check"){Console.WriteLine("shansha-native-open/1");return 0;}
  if(args.Length<1||(!System.IO.File.Exists(args[0])&&!System.IO.Directory.Exists(args[0]))){Console.Error.WriteLine("文件不存在，请检查保存位置。");return 3;}
  try{
   Application.OleRequired();
   if(args.Length<2||args[1]!="--choose"){
    var shell=new ShellInfo {Size=Marshal.SizeOf(typeof(ShellInfo)),Mask=0x100|0x400|0x40,Verb="open",File=args[0],Show=1};
    if(ShellExecuteEx(ref shell)){if(shell.Process!=IntPtr.Zero)CloseHandle(shell.Process);Pump();return 0;}
    if(System.IO.Directory.Exists(args[0])){Console.Error.WriteLine("系统暂时无法打开文件夹。");return 4;}
   }
   var info=new OpenInfo {File=args[0],Flags=4};int result=SHOpenWithDialog(IntPtr.Zero,ref info);
   if(result==-2147023673)return 2;
   if(result<0){Console.Error.WriteLine("系统未能打开文件，请换一个程序重试。错误码："+result);return 5;}
   Pump();return 0;
  }catch(Exception error){Console.Error.WriteLine("打开失败："+error.Message);return 6;}
 }
}
