/**
 * Washington Speech Fixtures
 *
 * Public-domain long-form speech fixtures used to stress STT speed,
 * long-form accuracy, and chunk/window behavior separately from the
 * short Harvard sentence corpus.
 */

export interface ILongSpeechFixture {
    id: string;
    audio: string;
    transcript: string;
    source: {
        title: string;
        url: string;
        speaker: string;
        date: string;
    };
    metadata: {
        words: number;
        durationSec: number;
        sampleRate: number;
        type: string;
    };
}

export const WASHINGTON_SPEECHES: ILongSpeechFixture[] = [
    {
        id: 'washington_01',
        audio: 'washington_01.wav',
        transcript: [
            'On the one hand, I was summoned by my country, whose voice I can never hear but with veneration and love,',
            'from a retreat which I had chosen with the fondest predilection, and, in my flattering hopes,',
            'with an immutable decision, as the asylum of my declining years.',
            'On the other hand, the magnitude and difficulty of the trust to which the voice of my country called me,',
            'being sufficient to awaken in the wisest and most experienced of her citizens a distrustful scrutiny into his qualifications,',
            'could not but overwhelm with despondence one who ought to be peculiarly conscious of his own deficiencies.',
            'In this conflict of emotions all I dare aver is that it has been my faithful study to collect my duty',
            'from a just appreciation of every circumstance by which it might be affected.',
            'All I dare hope is that if, in executing this task, I have been too much swayed by a grateful remembrance of former instances,',
            'my error will be palliated by the motives which mislead me,',
            'and its consequences be judged by my country with some share of the partiality in which they originated.'
        ].join(' '),
        source: {
            title: 'First Inaugural Address',
            url: 'https://avalon.law.yale.edu/18th_century/wash1.asp',
            speaker: 'George Washington',
            date: '1789-04-30'
        },
        metadata: {
            words: 191,
            durationSec: 65.81,
            sampleRate: 16000,
            type: 'public-domain-long-form-speech'
        }
    }
];

export const WASHINGTON_01 = WASHINGTON_SPEECHES[0];
