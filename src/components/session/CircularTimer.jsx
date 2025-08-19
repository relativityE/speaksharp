import React from 'react';
import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from 'recharts';

const CircularTimer = ({ elapsedTime }) => {
    const totalSeconds = elapsedTime;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    const data = [
        {
            name: 'seconds',
            value: seconds,
            fill: 'hsl(var(--primary))',
        },
    ];

    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    return (
        <div className="relative w-48 h-48 mx-auto">
            <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                    cx="50%"
                    cy="50%"
                    innerRadius="80%"
                    outerRadius="100%"
                    barSize={10}
                    data={data}
                    startAngle={90}
                    endAngle={-270}
                >
                    <PolarAngleAxis
                        type="number"
                        domain={[0, 60]}
                        angleAxisId={0}
                        tick={false}
                    />
                    <RadialBar
                        background={{ fill: 'hsl(var(--card))' }}
                        dataKey="value"
                        angleAxisId={0}
                        cornerRadius={10}
                    />
                </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute top-0 left-0 right-0 bottom-0 flex items-center justify-center">
                <span className="text-3xl font-bold font-mono text-foreground">
                    {formattedTime}
                </span>
            </div>
        </div>
    );
};

export default CircularTimer;
