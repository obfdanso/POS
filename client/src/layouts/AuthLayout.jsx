export function AuthLayout({ children }) {
  return (
    <div className="min-h-screen flex">
      {/* ── Left: Branding panel ── */}
      <div className="hidden md:flex w-1/2 flex-col items-center justify-center bg-gradient-to-br from-teal-800 via-emerald-900 to-gray-900 p-12 relative overflow-hidden">
        {/* Subtle background blobs */}
        <div className="absolute top-1/4 left-1/4 w-72 h-72 rounded-full bg-teal-500 opacity-10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-56 h-56 rounded-full bg-emerald-400 opacity-10 blur-3xl pointer-events-none" />

        <div className="relative z-10 text-center max-w-xs">
          {/* Logo icon */}
          <div className="flex justify-center mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className="w-20 h-20">
              <rect width="64" height="64" rx="14" ry="14" fill="rgba(255,255,255,0.15)"/>
              <circle cx="31" cy="27" r="12" fill="none" stroke="white" strokeWidth="5"/>
              <line x1="39" y1="35" x2="47" y2="44" stroke="white" strokeWidth="5" strokeLinecap="round"/>
              <circle cx="22" cy="55" r="4" fill="white"/>
              <circle cx="38" cy="55" r="4" fill="white"/>
            </svg>
          </div>

          <h1 className="text-4xl font-bold text-white mb-3">QuickMart</h1>
          <p className="text-teal-200 text-base mb-10">Modern retail management made simple</p>

          {/* Feature highlights */}
          <div className="space-y-4 text-left">
            <div className="flex items-center gap-3 text-white/75">
              <svg className="w-5 h-5 flex-shrink-0 text-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <span className="text-sm">Real-time inventory tracking</span>
            </div>
            <div className="flex items-center gap-3 text-white/75">
              <svg className="w-5 h-5 flex-shrink-0 text-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-sm">Smart analytics &amp; reports</span>
            </div>
            <div className="flex items-center gap-3 text-white/75">
              <svg className="w-5 h-5 flex-shrink-0 text-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="text-sm">Secure &amp; role-based access</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: Form panel ── */}
      <div className="flex-1 md:w-1/2 flex flex-col items-center justify-center bg-white dark:bg-gray-950 p-6 relative">
        {children}
      </div>
    </div>
  )
}
