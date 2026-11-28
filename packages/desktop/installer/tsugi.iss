; Compile only the verified unified TSUGI application payload.
#ifndef StageDir
  #error StageDir must identify the verified application payload
#endif
#ifndef OutputDir
  #error OutputDir must identify a clean build output directory
#endif
#ifndef AppVersion
  #error AppVersion must be specified
#endif

[Setup]
AppId=G1NYU.TSUGI.Windows
AppName=TSUGI
AppVersion={#AppVersion}
AppPublisher=TSUGI
AppPublisherURL=https://github.com/G1NYU/TSUGI
AppSupportURL=https://github.com/G1NYU/TSUGI/issues
AppUpdatesURL=https://github.com/G1NYU/TSUGI/releases
DefaultDirName={localappdata}\Programs\TSUGI
DefaultGroupName=TSUGI
DisableDirPage=no
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
AllowRootDirectory=no
AllowUNCPath=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\current\Tsugi.exe
SetupIconFile=..\app\icons\tsugi.ico
WizardStyle=modern dynamic
Compression=lzma2
SolidCompression=yes
OutputDir={#OutputDir}
OutputBaseFilename=Tsugi-windows-x64-setup
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#StageDir}\current\*"; DestDir: "{app}\current"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\BUILD-INFO.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\.tsugi-installed"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\README-INSTALL.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\TSUGI\TSUGI"; Filename: "{app}\current\Tsugi.exe"; WorkingDir: "{app}\current"
Name: "{userdesktop}\TSUGI"; Filename: "{app}\current\Tsugi.exe"; WorkingDir: "{app}\current"; Tasks: desktopicon
Name: "{userprograms}\TSUGI\Uninstall TSUGI"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\current\Tsugi.exe"; Description: "Launch TSUGI"; Flags: nowait postinstall skipifsilent

[Code]
function ContainsFiles(Directory: String): Boolean;
var
  Entry: TFindRec;
begin
  Result := False;
  if FindFirst(AddBackslash(Directory) + '*', Entry) then
  begin
    try
      repeat
        if (Entry.Name <> '.') and (Entry.Name <> '..') then
        begin
          Result := True;
          Break;
        end;
      until not FindNext(Entry);
    finally
      FindClose(Entry);
    end;
  end;
end;

function IsTsugiInstall(Directory: String): Boolean;
begin
  Result := FileExists(AddBackslash(Directory) + '.tsugi-installed') and
    FileExists(AddBackslash(Directory) + 'BUILD-INFO.json') and
    FileExists(AddBackslash(Directory) + 'current\Tsugi.exe') and
    not FileExists(AddBackslash(Directory) + '.portable');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Target, Previous: String;
begin
  Result := '';
  Target := ExpandConstant('{app}');
  Previous := GetPreviousData('InstallRoot', '');
  if FileExists(AddBackslash(Target) + '.portable') then
  begin
    Result := 'This is a portable TSUGI folder. Choose a separate installation folder to keep your existing data.';
    Exit;
  end;
  if (Previous <> '') and (CompareText(Previous, Target) <> 0) and IsTsugiInstall(Previous) then
  begin
    Result := 'TSUGI is already installed elsewhere. Uninstall that copy before choosing another drive. Your personal data will be preserved.';
    Exit;
  end;
  if DirExists(Target) and ContainsFiles(Target) and not IsTsugiInstall(Target) then
    Result := 'Choose a new or empty folder, or your existing installed TSUGI folder.';
end;

procedure RegisterPreviousData(PreviousDataKey: Integer);
begin
  SetPreviousData(PreviousDataKey, 'InstallRoot', ExpandConstant('{app}'));
end;
