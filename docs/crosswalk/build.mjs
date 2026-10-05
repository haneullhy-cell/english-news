#!/usr/bin/env node
// src/ 의 모듈을 하나의 스크립트로 묶어 index.html(완전한 문서)을 만든다.
// --artifact <경로> 를 주면 <body> 안에 들어가는 조각(claude.ai 아티팩트용)도 함께 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORDER = ['geo.js', 'signal.js', 'network.js', 'routing.js', 'osm.js', 'places.js', 'app.js'];
const strip = (src) => src
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^export\s+(?=(const|let|function|class|async)\b)/gm, '');

const bundle = ORDER
  .map((f) => `// ---- ${f} ----\n${strip(fs.readFileSync(path.join(here, 'src', f), 'utf8'))}`)
  .join('\n');
const page = fs.readFileSync(path.join(here, 'src', 'page.html'), 'utf8');
if (!page.includes('/*__BUNDLE__*/')) throw new Error('page.html에 /*__BUNDLE__*/ 자리가 없습니다');
const fragment = page.replace('/*__BUNDLE__*/', () => `(() => {\n'use strict';\n${bundle}\n})();`);

const head = [
  '<!doctype html>',
  '<html lang="ko">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  '<meta name="theme-color" content="#149a52">',
  '<meta name="description" content="횡단보도 보행 신호 잔여시간을 보고 걷는 길찾기 프로토타입. 강남 테헤란로 일대 개략도에서 거리만 본 경로와 신호를 본 경로를 비교합니다.">',
  '<link rel="manifest" href="manifest.json">',
  '<link rel="icon" href="icon-192.png">',
  '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<meta name="apple-mobile-web-app-title" content="초록불">',
  '<style>:root{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>',
  '</head>',
  '<body>',
  '',
].join('\n');

fs.writeFileSync(path.join(here, 'index.html'), `${head}${fragment}\n</body>\n</html>\n`);
const i = process.argv.indexOf('--artifact');
if (i > -1 && process.argv[i + 1]) fs.writeFileSync(process.argv[i + 1], fragment);
console.log(`index.html ${Buffer.byteLength(head + fragment)} bytes`);
