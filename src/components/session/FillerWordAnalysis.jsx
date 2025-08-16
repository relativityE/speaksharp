import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const FillerWordAnalysis = ({ fillerWords = {} }) => {
  // Sort filler words by count in descending order
  const sortedFillerWords = Object.entries(fillerWords || {}).sort(([, a], [, b]) => b - a);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Filler Word Analysis</CardTitle>
      </CardHeader>
      <CardContent>
        {sortedFillerWords.length > 0 ? (
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1">
              <AccordionTrigger>View Detailed Counts</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {sortedFillerWords.map(([word, count]) => (
                    <div key={word} className="flex justify-between">
                      <span>{word}</span>
                      <span>{count}</span>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : (
          <p>No filler words detected yet.</p>
        )}
      </CardContent>
    </Card>
  );
};

export default FillerWordAnalysis;
