import { gql } from '@apollo/client'
import React, { useContext } from 'react'
import { Helmet } from 'react-helmet'
import { Authorized } from '../routes/AuthorizedRoute'
import { Sidebar, SidebarContext } from '../sidebar/Sidebar'
import MainMenu from './MainMenu'

export const ADMIN_QUERY = gql`
  query adminQuery {
    myUser {
      admin
    }
  }
`

type LayoutProps = {
  children: React.ReactNode
  title: string
}

const Layout = ({ children, title, ...otherProps }: LayoutProps) => {
  const { pinned, content: sidebarContent } = useContext(SidebarContext)

  return (
    <>
      <Helmet>
        <title>{title ? `${title} - Photoview` : `Photoview`}</title>
      </Helmet>
      <div className="relative" {...otherProps} data-testid="Layout">
        {/* The header carried only the logo and the search bar while holding a
            sticky strip of every screen. Removed here rather than deleted, so
            restoring this one line brings it - and search - back. */}
        <div className="">
          <Authorized>
            <MainMenu />
          </Authorized>
          <div
            className={`mx-3 my-3 lg:mt-5 lg:mr-8 lg:ml-[292px] ${
              pinned && sidebarContent ? 'lg:pr-[420px]' : ''
            }`}
            id="layout-content"
          >
            {children}
          </div>
        </div>
        <Sidebar />
      </div>
    </>
  )
}

export default Layout
