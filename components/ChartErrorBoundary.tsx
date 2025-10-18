"use client";
import React from 'react';

type Props = {
  children: React.ReactNode;
  onReset?: () => void;
};

type State = { hasError: boolean; error?: Error | null };

export default class ChartErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // noop: could integrate logging here
    console.error('ChartErrorBoundary caught:', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[12rem] flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-semibold">圖表發生錯誤，已安全隔離</div>
          {this.state.error?.message && (
            <div className="mt-1 line-clamp-3 text-xs opacity-80">{String(this.state.error.message)}</div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-red-700 hover:bg-red-100"
            >
              重新載入圖表
            </button>
          </div>
        </div>
      );
    }
    return this.props.children as React.ReactElement;
  }
}

