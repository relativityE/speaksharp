import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { FillerWordTrends } from '@/types/analytics';

interface FillerWordTableProps {
    trendData: FillerWordTrends;
}

export const FillerWordTable: React.FC<FillerWordTableProps> = ({ trendData }) => {
    if (!trendData || Object.keys(trendData).length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Filler Word Trends</CardTitle>
                </CardHeader>
                <CardContent>
                    <p>Not enough session data to display trends.</p>
                </CardContent>
            </Card>
        );
    }

    const fillerWords = Object.keys(trendData);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Filler Word Trends</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-800">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">
                                    Filler Word
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">
                                    Latest Session
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">
                                    Previous Session
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-900 dark:divide-gray-700">
                            {fillerWords.map(word => (
                                <tr key={word}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">{word}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                        {trendData[word].current}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                        {trendData[word].previous}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    );
};
