" Claude Code Color Scheme for Vim
" A modern, minimal theme inspired by Anthropic's Claude

set background=dark
hi clear
if exists("syntax_on")
  syntax reset
endif
let g:colors_name = "claude"

" ─── Base Colors ───────────────────────────────────────────────────────────────
" Background:  #1a1a1a
" Surface:     #2d2d2d
" Border:      #404040
" Muted:       #808080
" Text:        #e5e5e5
" Orange:      #D97757
" Warm Orange: #cc785c
" ───────────────────────────────────────────────────────────────────────────────

" ─── Editor ────────────────────────────────────────────────────────────────────
hi Normal          guifg=#e5e5e5  guibg=#1a1a1a  ctermfg=253   ctermbg=234
hi Cursor          guifg=#1a1a1a  guibg=#D97757  ctermfg=234   ctermbg=173
hi CursorLine      guibg=#2d2d2d  ctermbg=236   cterm=NONE    gui=NONE
hi CursorColumn    guibg=#2d2d2d  ctermbg=236
hi LineNr          guifg=#606060  guibg=#1a1a1a  ctermfg=240   ctermbg=234
hi CursorLineNr    guifg=#D97757  guibg=#2d2d2d  ctermfg=173   ctermbg=236   gui=bold
hi SignColumn      guibg=#1a1a1a  ctermbg=234
hi VertSplit       guifg=#404040  guibg=#1a1a1a  ctermfg=238   ctermbg=234
hi ColorColumn     guibg=#2d2d2d  ctermbg=236

" ─── Status Line ───────────────────────────────────────────────────────────────
hi StatusLine      guifg=#e5e5e5  guibg=#2d2d2d  ctermfg=253   ctermbg=236   gui=NONE
hi StatusLineNC    guifg=#808080  guibg=#252525  ctermfg=244   ctermbg=235   gui=NONE
hi WildMenu        guifg=#1a1a1a  guibg=#D97757  ctermfg=234   ctermbg=173

" ─── Tabs ──────────────────────────────────────────────────────────────────────
hi TabLine         guifg=#808080  guibg=#252525  ctermfg=244   ctermbg=235   gui=NONE
hi TabLineFill     guibg=#1a1a1a  ctermbg=234
hi TabLineSel      guifg=#e5e5e5  guibg=#2d2d2d  ctermfg=253   ctermbg=236   gui=bold

" ─── Search ────────────────────────────────────────────────────────────────────
hi Search          guifg=#1a1a1a  guibg=#D97757  ctermfg=234   ctermbg=173
hi IncSearch       guifg=#1a1a1a  guibg=#e5e5e5  ctermfg=234   ctermbg=253

" ─── Visual ────────────────────────────────────────────────────────────────────
hi Visual          guibg=#3d3d3d  ctermbg=237
hi VisualNOS       guibg=#3d3d3d  ctermbg=237

" ─── Folding ───────────────────────────────────────────────────────────────────
hi Folded          guifg=#808080  guibg=#252525  ctermfg=244   ctermbg=235
hi FoldColumn      guifg=#606060  guibg=#1a1a1a  ctermfg=240   ctermbg=234

" ─── Diff ──────────────────────────────────────────────────────────────────────
hi DiffAdd         guifg=#a8cc8c  guibg=#2d3d2d  ctermfg=149   ctermbg=237
hi DiffChange      guifg=#dbab79  guibg=#3d3528  ctermfg=180   ctermbg=237
hi DiffDelete      guifg=#e88388  guibg=#3d2d2d  ctermfg=174   ctermbg=237
hi DiffText        guifg=#1a1a1a  guibg=#dbab79  ctermfg=234   ctermbg=180   gui=bold

" ─── Popup Menu ────────────────────────────────────────────────────────────────
hi Pmenu           guifg=#e5e5e5  guibg=#2d2d2d  ctermfg=253   ctermbg=236
hi PmenuSel        guifg=#1a1a1a  guibg=#D97757  ctermfg=234   ctermbg=173
hi PmenuSbar       guibg=#404040  ctermbg=238
hi PmenuThumb      guibg=#D97757  ctermbg=173

" ─── Messages ──────────────────────────────────────────────────────────────────
hi ErrorMsg        guifg=#e88388  guibg=#1a1a1a  ctermfg=174   ctermbg=234
hi WarningMsg      guifg=#dbab79  ctermfg=180
hi MoreMsg         guifg=#a8cc8c  ctermfg=149
hi Question        guifg=#D97757  ctermfg=173
hi Title           guifg=#D97757  ctermfg=173   gui=bold

" ─── Spelling ──────────────────────────────────────────────────────────────────
hi SpellBad        guisp=#e88388  gui=undercurl  cterm=underline  ctermfg=174
hi SpellCap        guisp=#71bef2  gui=undercurl  cterm=underline  ctermfg=117
hi SpellRare       guisp=#b9a0cb  gui=undercurl  cterm=underline  ctermfg=183
hi SpellLocal      guisp=#dbab79  gui=undercurl  cterm=underline  ctermfg=180

" ─── Syntax: General ───────────────────────────────────────────────────────────
hi Comment         guifg=#707070  ctermfg=242   gui=italic
hi Constant        guifg=#D97757  ctermfg=173
hi String          guifg=#a8cc8c  ctermfg=149
hi Character       guifg=#a8cc8c  ctermfg=149
hi Number          guifg=#dbab79  ctermfg=180
hi Boolean         guifg=#D97757  ctermfg=173
hi Float           guifg=#dbab79  ctermfg=180

hi Identifier      guifg=#e5e5e5  ctermfg=253
hi Function        guifg=#71bef2  ctermfg=117

hi Statement       guifg=#D97757  ctermfg=173   gui=NONE
hi Conditional     guifg=#D97757  ctermfg=173
hi Repeat          guifg=#D97757  ctermfg=173
hi Label           guifg=#D97757  ctermfg=173
hi Operator        guifg=#e5e5e5  ctermfg=253
hi Keyword         guifg=#D97757  ctermfg=173
hi Exception       guifg=#e88388  ctermfg=174

hi PreProc         guifg=#b9a0cb  ctermfg=183
hi Include         guifg=#b9a0cb  ctermfg=183
hi Define          guifg=#b9a0cb  ctermfg=183
hi Macro           guifg=#b9a0cb  ctermfg=183
hi PreCondit       guifg=#b9a0cb  ctermfg=183

hi Type            guifg=#71bef2  ctermfg=117   gui=NONE
hi StorageClass    guifg=#D97757  ctermfg=173
hi Structure       guifg=#71bef2  ctermfg=117
hi Typedef         guifg=#71bef2  ctermfg=117

hi Special         guifg=#cc785c  ctermfg=173
hi SpecialChar     guifg=#cc785c  ctermfg=173
hi Tag             guifg=#D97757  ctermfg=173
hi Delimiter       guifg=#e5e5e5  ctermfg=253
hi SpecialComment  guifg=#808080  ctermfg=244
hi Debug           guifg=#e88388  ctermfg=174

hi Underlined      guifg=#71bef2  ctermfg=117   gui=underline
hi Ignore          guifg=#404040  ctermfg=238
hi Error           guifg=#e88388  guibg=#3d2d2d  ctermfg=174  ctermbg=237
hi Todo            guifg=#1a1a1a  guibg=#D97757  ctermfg=234  ctermbg=173  gui=bold

" ─── Misc ──────────────────────────────────────────────────────────────────────
hi MatchParen      guifg=#e5e5e5  guibg=#606060  ctermfg=253  ctermbg=240  gui=bold
hi NonText         guifg=#404040  ctermfg=238
hi SpecialKey      guifg=#404040  ctermfg=238
hi Directory       guifg=#71bef2  ctermfg=117
hi Conceal         guifg=#808080  guibg=#1a1a1a  ctermfg=244  ctermbg=234

" ─── Treesitter (Neovim only) ───────────────────────────────────────────────────
if has('nvim')
  hi link @variable        Identifier
  hi link @function        Function
  hi link @function.call   Function
  hi link @keyword         Keyword
  hi link @string          String
  hi link @number          Number
  hi link @boolean         Boolean
  hi link @type            Type
  hi link @comment         Comment
  hi link @punctuation     Delimiter
  hi link @operator        Operator
  hi link @property        Identifier
  hi link @parameter       Identifier
endif
