import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Mic, Radio } from 'lucide-react';

export const SessionStatus: React.FC = () => {
    const navigate = useNavigate();

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Radio className="w-5 h-5 text-primary" />
                    Live Session
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center text-center p-6">
                <Mic className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="mb-4 text-muted-foreground">
                    Start a new practice session to get real-time feedback.
                </p>
                <Button onClick={() => navigate('/sessions')} size="lg" className="w-full">
                    Start New Session
                </Button>
            </CardContent>
        </Card>
    );
};
