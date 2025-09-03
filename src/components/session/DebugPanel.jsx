import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const DebugPanel = ({ user, profile, sessionData, error }) => {
    const renderObject = (obj) => {
        if (obj === null) return 'null';
        if (obj === undefined) return 'undefined';
        return JSON.stringify(obj, null, 2);
    };

    return (
        <Card className="mt-8 bg-gray-50 dark:bg-gray-900 border-dashed">
            <CardHeader>
                <CardTitle className="text-lg text-muted-foreground">-- DEBUG PANEL --</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs font-mono">
                <div>
                    <h4 className="font-bold mb-1">User:</h4>
                    <pre className="p-2 bg-gray-100 dark:bg-gray-800 rounded">{renderObject(user)}</pre>
                </div>
                <div>
                    <h4 className="font-bold mb-1">Profile:</h4>
                    <pre className="p-2 bg-gray-100 dark:bg-gray-800 rounded">{renderObject(profile)}</pre>
                </div>
                <div>
                    <h4 className="font-bold mb-1">Completed Session Data:</h4>
                    <pre className="p-2 bg-gray-100 dark:bg-gray-800 rounded">{renderObject(sessionData)}</pre>
                </div>
                 <div>
                    <h4 className="font-bold mb-1">Caught Error:</h4>
                    <pre className="p-2 bg-red-100 dark:bg-red-900 rounded text-red-800 dark:text-red-200">{error ? renderObject(error) : 'null'}</pre>
                </div>
            </CardContent>
        </Card>
    );
};
