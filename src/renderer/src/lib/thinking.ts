/** First sentence of the latest paragraph, markdown emphasis stripped, capped for one line. */
export function thinkingHeadline(text: string, latest = false): string {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const para = (latest ? paras[paras.length - 1] : paras[0]) ?? ''
  const plain = para.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim()
  const m = /^(.+?[。！？!?]|.+?\.(?=\s|$))/.exec(plain)
  const sentence = (m ? m[1] : plain).trim()
  return sentence.length > 90 ? sentence.slice(0, 88).trimEnd() + '…' : sentence
}
