import { useBranch } from '../hooks/useBranch'

const pin = (
  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

/**
 * Admins pick the branch they are working in (or all branches); everyone else sees their branch.
 * `compact` keeps it narrow for the header.
 */
export function BranchSwitcher({ className = '', compact = false }) {
  const { branches, branchId, currentBranch, canSwitch, setBranchId } = useBranch()

  if (!canSwitch) {
    if (!currentBranch) return null
    return (
      <span className={`inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300 ${className}`} title="Your branch">
        {pin}
        <span className={`truncate ${compact ? 'max-w-[8rem]' : 'max-w-[12rem]'}`}>{currentBranch.name}</span>
      </span>
    )
  }

  return (
    <label className={`inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300 ${className}`}>
      {pin}
      <span className="sr-only">Branch</span>
      <select
        aria-label="Branch"
        value={branchId ?? ''}
        onChange={(e) => setBranchId(e.target.value || null)}
        className={`${compact ? 'w-[9.5rem]' : 'max-w-[12rem]'} rounded-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-sm py-1 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-primary-500`}
      >
        <option value="">All branches</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  )
}
