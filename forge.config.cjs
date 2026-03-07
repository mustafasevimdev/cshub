module.exports = {
  packagerConfig: {
    asar: true,
    ignore: [
      /^\/\.git/,
      /^\/out($|\/)/,
      /^\/CsHubInstaller($|\/)/,
      /^\/src($|\/)/,
      /^\/supabase($|\/)/,
      /^\/scripts($|\/)/,
      /^\/\.codex($|\/)/,
      /^\/\.gemini($|\/)/,
      /^\/\.vscode($|\/)/,
      /\.md$/,
      /\.exe$/,
      /\.zip$/,
      /\.csproj$/,
      /\.user$/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-zip',
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
  ],
};

