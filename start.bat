@echo off
REM tt-jianpu-piano harness server on port 8823
cd /d E:\1workspace\tt-jianpu-piano
"C:\Users\4v\AppData\Local\Programs\Python\Python312\python.exe" -m http.server 8823 --bind 127.0.0.1
pause
