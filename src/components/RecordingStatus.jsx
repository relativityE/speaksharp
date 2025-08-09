import React from 'react';

export const RecordingStatus = ({ isRecording }) => {
  return (
    <div className="flex justify-center">
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
        {isRecording ? 'Recording...' : 'Not Recording'}
      </div>
    </div>
  );
};
