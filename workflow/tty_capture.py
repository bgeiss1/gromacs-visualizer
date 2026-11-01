#!/usr/bin/env python3
"""Runs one gmx command the way a student would at the terminal and saves what they would see.

    python3 tty_capture.py OUT.log [-a ANSWER]... -- gmx trjconv -f ... -o ...

GROMACS gets a real terminal (a pty), so its questions and answers come out in the order a
person sees them. Each -a is typed when GROMACS stops and waits at a question; the log marks
typed text as {{answer}}. With no answers left, Ctrl-D is sent (shown as {{^D}}).
"""
import os, pty, re, select, signal, sys, termios, time

args = sys.argv[1:]
out, answers = args.pop(0), []
while args and args[0] != '--':
    flag = args.pop(0)
    if flag == '-a': answers.append(args.pop(0))
    else: sys.exit(f'unknown option {flag}')
cmd = args[1:]
# A question is waiting when output has stopped and the last thing printed looks like one:
# "Select a group: ", or a numbered list (pdb2gmx's force fields and water models).
PROMPT = re.compile(r'(Select a group: |\n\s*\d+: [^\n]*\n\s*|Type .*: ?)$')
IDLE = 0.6

pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
attrs = termios.tcgetattr(fd)
attrs[3] &= ~termios.ECHO  # we write the typed text into the log ourselves, marked
termios.tcsetattr(fd, termios.TCSANOW, attrs)

log, last, sent_eof, done = '', time.time(), False, False
while not done:
    r, _, _ = select.select([fd], [], [], 0.1)
    if r:
        try: data = os.read(fd, 65536)
        except OSError: data = b''
        if not data: break
        log += data.decode('utf-8', 'replace').replace('\r\n', '\n')
        last = time.time()
        continue
    if os.waitpid(pid, os.WNOHANG)[0]:
        # drain what is left
        try:
            while True:
                data = os.read(fd, 65536)
                if not data: break
                log += data.decode('utf-8', 'replace').replace('\r\n', '\n')
        except OSError: pass
        break
    if time.time() - last < IDLE: continue
    if PROMPT.search(log[-300:]) or time.time() - last > 20:
        if answers:
            a = answers.pop(0)
            log += '{{' + a + '}}\n'
            os.write(fd, (a + '\n').encode())
        elif not sent_eof:
            log += '{{^D}}\n'
            os.write(fd, b'\x04'); sent_eof = True
        else:
            os.kill(pid, signal.SIGTERM); done = True
        last = time.time()
try: os.waitpid(pid, 0)
except ChildProcessError: pass
# mdrun-style progress lines rewrite themselves with \r; keep the last version of each line
log = '\n'.join(l.split('\r')[-1] for l in log.split('\n'))
with open(out, 'w') as f:
    f.write('$ ' + ' '.join(cmd) + '\n' + log)
