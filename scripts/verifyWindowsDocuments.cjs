const fs = require('node:fs');
const path = require('node:path');

module.exports = async (context) => {
  if (context.electronPlatformName !== 'win32') return;
  const directory = path.join(context.packager.info.appDir, 'native', 'windows-documents', 'publish');
  for (const filename of ['VRHub.WindowsDocuments.exe', 'VRHub.WindowsDocuments.dll', 'VRHub.WindowsDocuments.runtimeconfig.json', 'coreclr.dll', 'Microsoft.Windows.SDK.NET.dll']) {
    if (!fs.existsSync(path.join(directory, filename))) throw new Error('Native Windows documents component missing. Run npm run build:windows-documents before packaging.');
  }
};
