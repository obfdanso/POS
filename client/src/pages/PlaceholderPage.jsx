import { useAuth } from '../hooks/useAuth'

export default function PlaceholderPage({ title }) {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-8 text-center max-w-md">
        <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">{title}</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">Logged in as <strong>{user?.full_name}</strong></p>
        <p className="text-gray-400 dark:text-gray-500 text-xs mb-6">Role: {user?.role}</p>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">This page will be built in the next phase.</p>
        <button
          onClick={logout}
          className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full transition"
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}
