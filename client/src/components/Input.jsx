export function Input({ label, error, className = '', id, name, ...props }) {
  const inputId = id || name;
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={inputId} className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>}
      <input
        id={inputId}
        name={name}
        className={`block w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition
          bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500
          ${error ? 'border-danger-500 bg-danger-50 dark:bg-danger-900/20' : 'border-gray-300 dark:border-gray-700'}
          ${props.disabled ? 'bg-gray-100 dark:bg-gray-900 cursor-not-allowed opacity-60' : ''}
          ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-danger-600 dark:text-danger-400">{error}</p>}
    </div>
  )
}
