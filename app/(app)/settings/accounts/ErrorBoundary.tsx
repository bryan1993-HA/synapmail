'use client'

import { Component, ReactNode } from 'react'

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-8 max-w-2xl">
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
            <p className="font-semibold text-destructive mb-2">Erreur client :</p>
            <pre className="text-xs text-destructive/80 whitespace-pre-wrap break-all">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
