# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - link "SpeakSharp" [ref=e6] [cursor=pointer]:
        - /url: /
      - navigation [ref=e8]:
        - link "Login / Sign Up" [ref=e9] [cursor=pointer]:
          - /url: /auth
  - main [ref=e10]:
    - region "Notifications alt+T"
    - generic [ref=e12]:
      - generic [ref=e14]:
        - generic [ref=e16]:
          - generic [ref=e17]:
            - heading "Live Transcript" [level=2] [ref=e18]
            - paragraph [ref=e19]: Your spoken words appear here. Filler words are highlighted.
          - generic [ref=e20]:
            - paragraph
        - generic [ref=e22]:
          - generic [ref=e24]: Filler Word Analysis
          - generic [ref=e25]:
            - generic [ref=e28]:
              - img [ref=e29]
              - heading "No Filler Words Detected Yet" [level=3] [ref=e31]
              - paragraph [ref=e32]: Start speaking to see your filler word analysis here. Your most frequent words will appear at the top.
            - generic [ref=e33]:
              - generic [ref=e34]: "Custom Filler Word:"
              - textbox "Custom Filler Word:" [ref=e35]
              - button "Add custom filler word" [ref=e36]:
                - img
      - button "Open session controls" [ref=e37]:
        - img
        - generic [ref=e38]: Open session controls
```