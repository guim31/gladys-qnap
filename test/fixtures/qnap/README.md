# QTS answers

Real answers of the QTS CGI API, one folder per model and firmware, from the
tests of [python-qnapstats](https://github.com/colinodell/python-qnapstats)
(Colin O'Dell, MIT License, see `LICENSE-qnapstats`), the library behind the Home Assistant `qnap`
integration. Copied as they are, with the addresses, MAC addresses, serial
numbers, host names and session ids replaced by invented values (IP addresses
in 192.0.2.0/24, MAC addresses 02:00:5e:…, serial numbers `TESTDISK…` and
`Q000TEST…`, host names `NAS-TEST-…`).

| File                  | Request                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| `login.xml`           | `POST authLogin.cgi`                                                        |
| `login_with_get.xml`  | `GET authLogin.cgi?user=…&pwd=…` (QTS 4.5.1)                                |
| `systemstats.xml`     | `management/manaRequest.cgi?subfunc=sysinfo&hd=no&multicpu=1`               |
| `systemhealth.xml`    | `management/manaRequest.cgi?subfunc=sysinfo&sysHealth=1` (not used)         |
| `volumes.xml`         | `management/chartReq.cgi?chart_func=disk_usage&disk_select=all&include=all` |
| `smartdiskhealth.xml` | `disk/qsmart.cgi?func=all_hd_data`                                          |
| `bandwidth.xml`       | `management/chartReq.cgi?chart_func=QSM40bandwidth`                         |
| `bandwidth2.xml`      | `management/chartReq.cgi?chart_func=bandwidth` (QTS 4.5.4 and later)        |
| `firmwareupdate.xml`  | `sys/sysRequest.cgi?subfunc=firm_update`                                    |

`TS-251-4.5.1/systemstats.xml` and the `login.xml` of a few folders were
copied by qnapstats from other models (see the comment in the files).
The fake NAS of the tests (`test/helpers/fakeQnap.js`) serves the TS-EC1280U
system with the volume and disks of the TS-451, and edits them in place for a
test (CPU, volume state, disk health, firmware offered). A real answer of a
QTS 5 or QuTS hero NAS, anonymized the same way, is welcome.
