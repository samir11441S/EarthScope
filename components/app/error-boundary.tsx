"use client";
import { Component, type ReactNode } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { reportError } from "@/lib/telemetry";

/** Keeps one failing feature from blanking the whole app; reports the error and offers a retry. */
export class FeatureBoundary extends Component<{ children: ReactNode; name: string; retryLabel: string; message: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { reportError(error, `render:${this.props.name}`); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="feature-error" role="alert"><TriangleAlert size={20}/><p>{this.props.message}</p><button className="outline-button" onClick={() => this.setState({ failed: false })}><RefreshCw size={14}/> {this.props.retryLabel}</button></div>;
  }
}
