"use client";
import React from "react";
import { t } from "../lib/i18n";

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
    console.error("ChartErrorBoundary caught:", error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[12rem] flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-semibold">{t('chart.error.title')}</div>
          {this.state.error?.message && (
            <div className="mt-1 line-clamp-3 text-xs opacity-80">{String(this.state.error.message)}</div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-red-700 hover:bg-red-100"
            >
              {t('chart.error.retry')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children as React.ReactElement;
  }
}
