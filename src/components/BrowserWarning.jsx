import React from 'react';
import { AlertTriangle } from 'lucide-react';

export const BrowserWarning = ({ support }) => {
  if (support.speechRecognition) return null

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
      <div className="flex">
        <AlertTriangle className="h-5 w-5 text-yellow-400" />
        <div className="ml-3">
          <h3 className="text-sm font-medium text-yellow-800">Browser Compatibility Issue</h3>
          <div className="mt-2 text-sm text-yellow-700">
            <p>SpeakSharp works best with:</p>
            <ul className="list-disc ml-5 mt-1">
              <li>Chrome (recommended)</li>
              <li>Edge</li>
              <li>Safari (limited)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
