import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

export const InfoCard = ({ title, children }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-semibold text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-gray-600">{children}</p>
      </CardContent>
    </Card>
  );
};
