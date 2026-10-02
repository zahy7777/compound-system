import {build} from 'esbuild'
await build({entryPoints: ['frontend/main.js'], bundle: true, format: 'esm', target: 'es2022', outfile: 'frontend/app.js', charset: 'utf8'})
await build({entryPoints: ['frontend/main.css'], bundle: true, outfile: 'frontend/style.css', loader:{'.png':'file','.svg':'dataurl'}, assetNames:'theme/assets/[name]-[hash]'})
