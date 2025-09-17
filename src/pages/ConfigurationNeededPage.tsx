import React from 'react';

const ConfigurationNeededPage: React.FC = () => {
  return (
    <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'Arial, sans-serif' }}>
      <h1>Configuration Needed</h1>
      <p>
        This application is not configured correctly. Critical environment variables
        are missing.
      </p>
      <p>
        Please contact the system administrator or refer to the installation
        documentation to set up the necessary <code>.env</code> file.
      </p>
    </div>
  );
};

export default ConfigurationNeededPage;
