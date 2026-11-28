# python3 -I splice.py  (run from the directory make-clips.sh wrote) - rebuilds splice_A..D: the same audio moved between positions
import wave, struct
def rd(f):
    w=wave.open(f); n=w.getnframes(); return list(struct.unpack('<%dh'%n, w.readframes(n)))
def wr(f, s):
    w=wave.open(f,'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(struct.pack('<%dh'%len(s), *s)); w.close()
c=lambda t:int(t*16000)
mid=rd('voices/Samantha_Uh.wav'); ini=rd('clips/t_uh.wav'); ah=rd('clips/t_ah.wav')
tok_mid=mid[c(0.727):c(1.081)]; tok_ini=ini[:c(0.36)]; tok_ah=ah[:c(0.36)]
wr('splice_A_midUh_at_start.wav', tok_mid + ini[c(0.36):])
wr('splice_B_initUh_at_mid.wav', mid[:c(0.727)] + tok_ini + mid[c(1.081):])
wr('splice_C_initAh_at_mid.wav', mid[:c(0.727)] + tok_ah + mid[c(1.081):])
wr('splice_D_midUh_alone.wav', [0]*c(0.3) + tok_mid + [0]*c(0.5) + ini[c(0.36):])
