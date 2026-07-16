import type { AssetDetail } from '../../../shared/ipc.js'

export function AssetFileTree({ files }: { files: AssetDetail['files'] }) {
  if (!files.length) return <p className="detail-muted">没有文件</p>
  return <ul className="asset-file-tree" aria-label="文件树">
    {files.map((file) => <li key={file.relativePath} className="asset-file-row">
      <span>{file.relativePath}</span>
      <small>{file.kind === 'binary' ? '二进制' : '文本'} · {file.size.toLocaleString()} B</small>
    </li>)}
  </ul>
}
