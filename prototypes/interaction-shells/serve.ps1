$prototypeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
python -m http.server 4173 --bind 127.0.0.1 --directory $prototypeRoot
