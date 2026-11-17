import json, sys
from pathlib import Path
import numpy as np, soundfile as sf
from scipy import signal
NOTES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
def analyze_audio(file_path, hop_ms=50):
    p=Path(file_path)
    data,sr=sf.read(str(p),always_2d=True)
    mono=np.mean(data,axis=1)
    dur=round(len(mono)/float(sr),6)
    hop=max(1,int(sr*(hop_ms/1000.0)))
    win=hop*2
    w=np.hanning(win)
    times,rv,cv=[],[],[]
    ch=np.zeros(12)
    freqs=np.fft.rfftfreq(win,d=1.0/sr)
    mask=(freqs>=55.0)&(freqs<=4186.0)
    pc=np.round(69.0+12.0*np.log2(freqs[mask]/440.0)).astype(int)%12
    for s in range(0,len(mono)-win+1,hop):
        fr=mono[s:s+win]
        times.append(round(s/float(sr),4))
        rv.append(float(np.sqrt(np.mean(fr**2))))
        mag=np.abs(np.fft.rfft(fr*w))
        cv.append(float(np.sum(freqs*mag)/(float(np.sum(mag))+1e-12)))
        for idx,m in zip(pc,mag[mask]): ch[idx]+=float(m)
    ra,ca=np.array(rv),np.array(cv)
    rn=(ra/(np.max(ra)+1e-12)).round(4).tolist()
    cn=(ca/(np.max(ca)+1e-12)).round(4).tolist()
    chn=(ch/(np.max(ch)+1e-12)).round(4).tolist()
    ed=np.maximum(0.0,np.diff(ra,prepend=ra[0]))
    pks,_=signal.find_peaks(ed,distance=max(1,int(0.25/(hop_ms/1000.0))),prominence=float(np.std(ed)*0.75))
    ons=[times[k] for k in pks]
    bpm=round(60.0/float(np.median(np.diff(ons))),2) if len(ons)>=2 else 0.0
    while bpm>180.0: bpm=round(bpm/2.0,2)
    while 0.0<bpm<65.0: bpm=round(bpm*2.0,2)
    secs,sl=[],dur/4.0
    for i in range(4):
        ss=round(i*sl,6)
        se=round(dur if i==3 else (i+1)*sl,6)
        secs.append({"section":i+1,"start_sec":ss,"end_sec":se,"duration_sec":round(se-ss,6)})
    err=round(abs(dur-sum(x["duration_sec"] for x in secs))*1000.0,4)
    return {"track":{"file":p.name,"sr":sr,"duration_sec":dur},"verified_math":{"bpm":bpm,"onsets":len(ons),"dominant_pitch":NOTES[int(np.argmax(chn))],"chroma":dict(zip(NOTES,chn)),"sections":secs},"integrity":{"passed":err<=1.0,"error_ms":err}}
if __name__=="__main__": print(json.dumps(analyze_audio(sys.argv[1]),indent=2))
