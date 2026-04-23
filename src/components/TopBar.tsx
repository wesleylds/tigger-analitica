import { useState } from 'react'
import { virtualPlatformOptions } from '../data/staticData'
import { getPlatformLabel } from '../lib/platformLabel'
import type { Page, Platform } from '../types'

type TopMenuKey = 'virtual' | 'extras' | 'user' | null
type VirtualMenuItem = Platform

interface TopBarProps {
  activePage: Page
  currentPlan: string
  menuOpen: boolean
  onLogout: () => void
  profileName: string
  setActivePage: (page: Page) => void
  setMenuOpen: (open: boolean) => void
  onSelectVirtualMenu: (item: VirtualMenuItem) => void
}

const virtualMenuItems: VirtualMenuItem[] = virtualPlatformOptions

const extraMenuItems: Array<{ label: string; page: Page; tone?: 'highlight' }> = [
  { label: 'Sugestoes', page: 'account' },
  { label: 'Indique e Ganhe 50%', page: 'plans', tone: 'highlight' },
  { label: 'Grupo da Plataforma', page: 'alerts' },
]

const userItems: Array<{ label: string; page: Page }> = [
  { label: 'Conta', page: 'account' },
  { label: 'Planos', page: 'plans' },
  { label: 'Admin', page: 'admin' },
]

export function TopBar({
  activePage,
  currentPlan,
  menuOpen,
  onLogout,
  profileName,
  setActivePage,
  setMenuOpen,
  onSelectVirtualMenu,
}: TopBarProps) {
  const [openMenu, setOpenMenu] = useState<TopMenuKey>(null)
  const userInitials = profileName.trim().slice(0, 2).toUpperCase() || 'TA'

  const closeMenus = () => setOpenMenu(null)

  return (
    <header className="topbar">
      <div className="brand-cluster">
        <button type="button" className="menu-button" onClick={() => setMenuOpen(!menuOpen)}>
          Menu
        </button>

        <button
          type="button"
          className="brand-lockup"
          onClick={() => {
            setActivePage('analysis')
            setMenuOpen(false)
            closeMenus()
          }}
        >
          <img className="brand-logo" src="/images/tigger-logo.png" alt="Tigger" />
          <div className="brand-copy">
            <strong>Tigger Analytics.</strong>
          </div>
        </button>
      </div>

      <div className={`topbar-grid ${menuOpen ? 'is-open' : ''}`}>
        <nav className="primary-nav" aria-label="Principal">
          <button
            type="button"
            className={`nav-button ${activePage === 'ranking' ? 'active' : ''}`}
            onClick={() => {
              setActivePage('ranking')
              setMenuOpen(false)
              closeMenus()
            }}
          >
            <span>Dashboard</span>
          </button>

          <div className={`nav-menu-shell ${openMenu === 'virtual' ? 'open' : ''}`}>
            <button
              type="button"
              className={`nav-button ${activePage === 'analysis' ? 'active' : ''}`}
              onClick={() => setOpenMenu((current) => (current === 'virtual' ? null : 'virtual'))}
            >
              <span>Futebol Virtual</span>
              <span className="nav-arrow" aria-hidden="true" />
            </button>

            <div className="nav-dropdown">
              {virtualMenuItems.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="nav-dropdown-item"
                  onClick={() => {
                    onSelectVirtualMenu(item)
                    setMenuOpen(false)
                    closeMenus()
                  }}
                >
                  {getPlatformLabel(item)}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className={`nav-button ${activePage === 'bots' ? 'active' : ''}`}
            onClick={() => {
              setActivePage('bots')
              setMenuOpen(false)
              closeMenus()
            }}
          >
            <span>Criar Bots</span>
          </button>

          <div className={`nav-menu-shell ${openMenu === 'extras' ? 'open' : ''}`}>
            <button
              type="button"
              className={`nav-button ${['history', 'alerts'].includes(activePage) ? 'active' : ''}`}
              onClick={() => setOpenMenu((current) => (current === 'extras' ? null : 'extras'))}
            >
              <span>Extras</span>
              <span className="nav-arrow" aria-hidden="true" />
            </button>

            <div className="nav-dropdown">
              {extraMenuItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className={`nav-dropdown-item ${activePage === item.page ? 'active' : ''} ${
                    item.tone === 'highlight' ? 'highlight' : ''
                  }`}
                  onClick={() => {
                    setActivePage(item.page)
                    setMenuOpen(false)
                    closeMenus()
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </nav>

        <div className="topbar-actions">
          <button
            type="button"
            className="support-link"
            onClick={() => {
              setActivePage('account')
              setMenuOpen(false)
              closeMenus()
            }}
          >
            Suporte
          </button>

          <div className={`user-menu-shell ${openMenu === 'user' ? 'open' : ''}`}>
            <button
              type="button"
              className="user-chip"
              onClick={() => setOpenMenu((current) => (current === 'user' ? null : 'user'))}
            >
              <div className="user-avatar">{userInitials}</div>
              <div className="user-copy">
                <span>{profileName}</span>
                <strong>{currentPlan}</strong>
              </div>
              <span className={`user-caret ${openMenu === 'user' ? 'is-open' : ''}`} aria-hidden="true" />
            </button>

            <div className="user-dropdown">
              <div className="user-dropdown-head">
                <div className="user-dropdown-identity">
                  <strong>{profileName}</strong>
                  <span className="user-dropdown-plan">{currentPlan}</span>
                </div>
              </div>

              {userItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className={`user-dropdown-item ${activePage === item.page ? 'active' : ''}`}
                  onClick={() => {
                    setActivePage(item.page)
                    setMenuOpen(false)
                    closeMenus()
                  }}
                >
                  {item.label}
                </button>
              ))}

              <div className="user-dropdown-footer">
                <button
                  type="button"
                  className="user-dropdown-logout"
                  onClick={() => {
                    onLogout()
                    setMenuOpen(false)
                    closeMenus()
                  }}
                >
                  Sair da conta
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
