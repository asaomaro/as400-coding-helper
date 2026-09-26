#!/bin/sh
cat lib.js - | curl -s --data-binary @- 127.0.0.1:47112/eval
