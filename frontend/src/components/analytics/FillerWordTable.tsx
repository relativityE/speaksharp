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
                    <table className="min-w-full divide-y divide-neutral-border">
                        <thead className="bg-neutral-band">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-neutral-secondary uppercase tracking-wider">
                                    Filler Word
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-neutral-secondary uppercase tracking-wider">
                                    Latest Session
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-neutral-secondary uppercase tracking-wider">
                                    Previous Session
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-neutral-border">
                            {fillerWords.map(word => (
                                <tr key={word}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-neutral-body capitalize">{word}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-secondary">
                                        {trendData[word].current}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-secondary">
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
