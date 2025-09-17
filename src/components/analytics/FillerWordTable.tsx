import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { FillerWordTrends } from '@/types/analytics';

const severityColorMap: Record<string, string> = {
    red: 'bg-red-200 dark:bg-red-800',
    orange: 'bg-orange-200 dark:bg-orange-800',
    yellow: 'bg-yellow-200 dark:bg-yellow-800',
    green: 'bg-green-200 dark:bg-green-800',
};

interface FillerWordTableProps {
    trendData: FillerWordTrends;
}

export const FillerWordTable: React.FC<FillerWordTableProps> = ({ trendData }) => {
    if (!trendData || Object.keys(trendData).length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Top Filler Words</CardTitle>
                </CardHeader>
                <CardContent>
                    <p>Not enough session data to display trends.</p>
                </CardContent>
            </Card>
        );
    }

    const fillerWords = Object.keys(trendData);
    // Assuming all filler words have the same number of session data points
    const sessionCount = trendData[fillerWords[0]]?.length || 0;
    const sessionHeaders = Array.from({ length: sessionCount }, (_, i) => `Session ${i + 1}`);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Top Filler Words</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-800">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">
                                    Filler Word
                                </th>
                                {sessionHeaders.map(header => (
                                    <th key={header} scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">
                                        {header}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-900 dark:divide-gray-700">
                            {fillerWords.map(word => (
                                <tr key={word}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{word}</td>
                                    {trendData[word].map((data, index) => (
                                        <td
                                            key={`${word}-${index}`}
                                            title={data.tooltip}
                                            className={`px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 ${severityColorMap[data.severity] || ''}`}
                                        >
                                            {data.count}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    );
};
