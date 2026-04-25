export interface FillerGroundTruth {
    id: string;
    audio: string;
    transcript: string;
    expectedFillers: { [key: string]: number };
}

export const FILLER_SENTENCES: FillerGroundTruth[] = [
    {
        id: "conv_01",
        audio: "conv_01.wav",
        transcript: "Um. Basically, we should literally like, wait.",
        expectedFillers: {
            "um": 1,
            "basically": 1,
            "literally": 1,
            "like": 1
        }
    },
    {
        id: "conv_02",
        audio: "conv_02.wav",
        transcript: "Well, I mean, you know, it is what it is.",
        expectedFillers: {
            "i mean": 1,
            "you know": 1
        }
    }
];
