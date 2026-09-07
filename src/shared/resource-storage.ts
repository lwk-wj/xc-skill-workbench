const separatorFor = (path: string): '/' | '\\' =>
  path.includes('\\') && !path.includes('/') ? '\\' : '/'

const trimTrailingSeparators = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/u, '')
  return trimmed || path.slice(0, 1)
}

export const resourceRootFromAssetStore = (assetStorePath: string): string => {
  const normalized = trimTrailingSeparators(assetStorePath.trim())
  const separator = separatorFor(normalized)
  const parts = normalized.split(/[\\/]/u)
  if (parts.at(-1) !== 'store') return normalized
  const parent = parts.slice(0, -1).join(separator)
  return parent || separator
}

export const assetStorePathForRoot = (resourceRoot: string): string => {
  const normalized = trimTrailingSeparators(resourceRoot.trim())
  return `${normalized}${separatorFor(normalized)}store`
}

export const repositoryCachePathForRoot = (resourceRoot: string): string => {
  const normalized = trimTrailingSeparators(resourceRoot.trim())
  return `${normalized}${separatorFor(normalized)}repositories`
}
