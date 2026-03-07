const fs = require('fs');
const pngToIco = require('png-to-ico');

pngToIco('public/logo/indir.png')
  .then(buf => {
    fs.writeFileSync('CsHubInstaller/logo.ico', buf);
    console.log('Successfully created logo.ico');
  })
  .catch(console.error);
