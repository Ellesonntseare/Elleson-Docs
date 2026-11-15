import {renderWordPages} from './word-pages.mjs'
window.renderWordForPrint=bytes=>renderWordPages(bytes,document.getElementById('document'),document.getElementById('styles'))
