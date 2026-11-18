import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { OfflineBanner } from '../components/OfflineBanner'

describe('OfflineBanner', () => {
  afterEach(() => vi.restoreAllMocks())

  it('appears when the connection drops and goes when it returns', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    render(<OfflineBanner />)
    expect(screen.queryByRole('status')).toBeNull()

    onLine.mockReturnValue(false)
    act(() => window.dispatchEvent(new Event('offline')))
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i)

    onLine.mockReturnValue(true)
    act(() => window.dispatchEvent(new Event('online')))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
