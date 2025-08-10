import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

export const RecordingStatus = ({ isRecording, totalFillerWords }) => {
  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        <div className="text-center space-y-2">
          <div
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${
              isRecording ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'
            }`}
          >
            <div
              className={`w-3 h-3 rounded-full ${
                isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-400'
              }`}
            ></div>
            {isRecording ? 'Recording...' : 'Ready to Record'}
          </div>
          <div className="text-sm text-gray-600">
            Total filler words detected: <span className="font-semibold">{totalFillerWords}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
