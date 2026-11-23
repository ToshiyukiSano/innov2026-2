import time
import gc
import network
import M5
from M5 import *
from hardware import I2C, Pin
from unit import ENVUnit
import json  # 変更：GASのJSON応答を解析

# This UIFlow2 firmware may ship the HTTP client as requests2 or requests.
try:
    import requests2 as http_client
except ImportError:
    import requests as http_client

# ============================================================
# Google Apps Script settings
# ============================================================
GAS_URL = "https://script.google.com/macros/s/XXXX/exec"  # 変更
TOKEN = "YOUR_TOKEN"  # 変更
DEVICE_ID = "stick-01"  # 変更：機器ごとに設定
SEND_INTERVAL_SEC = 60  # 変更：60秒間隔
# ============================================================

LED_PIN = 10
LED_ON = 0
LED_OFF = 1
BG = 0x101820

SEND_INTERVAL_MS = SEND_INTERVAL_SEC * 1000

i2c0 = None
env3 = None
wlan = None
led = None
next_send_ms = 0
led_off_ms = -1
last_ui_ms = 0
send_count = 0


def draw_line(y, text, color):
    M5.Lcd.fillRect(0, y, 80, 10, BG)
    M5.Lcd.setTextColor(color, BG)
    M5.Lcd.setCursor(0, y)
    M5.Lcd.print(text)


def led_set(on):
    led.value(LED_ON if on else LED_OFF)


def read_env():
    return (env3.read_temperature(), env3.read_humidity(), env3.read_pressure())


# 変更：GASにJSONを送信し、応答を確認する
def post_env(t, h, p):
    # ENV III returns degC, %RH and hPa.
    payload = {
        "token": TOKEN,                 # 変更
        "device_id": DEVICE_ID,         # 変更
        "temperature_c": round(t, 1),  # 変更
        "humidity_pct": round(h, 1),   # 変更
        "pressure_hpa": round(p, 2),   # 変更
        "source": "m5stickc",          # 変更
    }

    resp = None
    try:
        gc.collect()

        # 変更：元の通信ライブラリとjson引数を使用
        resp = http_client.post(
            GAS_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
        )

        code = resp.status_code  # 変更
        result_status = "unknown"  # 変更
        result_message = ""  # 変更

        # 変更：GASの応答JSONを確認
        # HTTP 302ではJSONが返らないことがある
        try:
            data = json.loads(resp.text)
            if isinstance(data, dict):
                result_status = str(data.get("status", "unknown"))
                result_message = str(data.get("message", ""))
        except Exception:
            if code == 302:
                result_status = "redirect"
                result_message = "302: response not confirmed"
            else:
                result_message = "JSON response unavailable"

        return code, result_status, result_message  # 変更

    finally:
        if resp is not None:
            try:
                resp.close()
            except Exception:
                pass


def err_short(e):
    if isinstance(e, OSError) and e.args:
        return "ERR " + str(e.args[0])
    return "ERR"


def do_cycle():
    global led_off_ms, send_count

    try:
        t, h, p = read_env()
    except Exception as e:
        print("ENV III read failed:", e)
        draw_line(54, "SENSOR ERR", 0xFF6060)
        return

    print("T", t, "H", h, "P", p)
    draw_line(14, "T " + str(round(t, 1)) + "C", 0xFFFFFF)
    draw_line(26, "H " + str(round(h, 1)) + "%", 0xFFFFFF)
    draw_line(38, "P" + str(round(p, 2)) + "hPa", 0xFFFFFF)

    # 変更：送信温度を画面に表示
    draw_line(46, "Tx " + str(round(t, 1)) + "C", 0x60D0FF)

    if not wlan.isconnected():
        draw_line(54, "NO WIFI", 0xFF6060)
        return

    led_set(True)
    led_off_ms = time.ticks_add(time.ticks_ms(), 1000)
    draw_line(54, "SENDING", 0xFFD060)

    try:
        # 変更：HTTPコードとGASのstatus/messageを取得
        code, status, message = post_env(t, h, p)
    except Exception as e:
        print("POST failed:", e)
        draw_line(54, err_short(e), 0xFF6060)
        draw_line(82, "POST ERROR", 0xFF6060)  # 変更
        return

    # 変更：HTTP 200だけでは成功と判断しない
    print("HTTP:", code)
    print("GAS status:", status)
    print("GAS message:", message)
    print("Sent temperature:", round(t, 1))

    # 変更：画面にHTTP状態コードとstatusを表示
    if status == "ok":
        send_count += 1
        draw_line(54, "HTTP " + str(code), 0x60FF90)
        draw_line(82, "ok #" + str(send_count), 0x60FF90)
    elif status == "error":
        draw_line(54, "HTTP " + str(code), 0xFF6060)
        draw_line(82, "error", 0xFF6060)
    else:
        draw_line(54, "HTTP " + str(code), 0xFFD060)
        draw_line(82, status[:13], 0xFFD060)

    # 変更：messageは画面幅に合わせて短縮
    draw_line(90, message[:13], 0xFFD060)


def setup():
    global i2c0, env3, wlan, led, next_send_ms, last_ui_ms

    M5.begin()
    M5.Lcd.fillScreen(BG)
    M5.Lcd.setTextSize(1)
    draw_line(0, "ENV III", 0x60D0FF)
    draw_line(112, "GAS", 0x60D0FF)  # 変更
    draw_line(124, "HTTPS POST", 0x8090A0)

    try:
        Power.setExtOutput(True)
    except Exception as e:
        print("ext power failed:", e)

    led = Pin(LED_PIN, mode=Pin.OUT)
    led.value(LED_OFF)

    i2c0 = I2C(0, scl=Pin(33), sda=Pin(32), freq=100000)
    env3 = ENVUnit(i2c=i2c0, type=3)

    wlan = network.WLAN(network.STA_IF)

    now = time.ticks_ms()
    next_send_ms = now
    last_ui_ms = now


def loop():
    global next_send_ms, led_off_ms, last_ui_ms

    M5.update()
    now = time.ticks_ms()

    if led_off_ms >= 0 and time.ticks_diff(now, led_off_ms) >= 0:
        led_set(False)
        led_off_ms = -1

    if time.ticks_diff(now, next_send_ms) >= 0:
        do_cycle()

        # 変更：通信失敗時も次の送信を予約
        # Wi-Fi未接続時は元の5秒間隔で再確認
        after_send_ms = time.ticks_ms()
        if wlan.isconnected():
            next_send_ms = time.ticks_add(
                after_send_ms, SEND_INTERVAL_MS
            )
        else:
            next_send_ms = time.ticks_add(
                after_send_ms, 5000
            )

    if time.ticks_diff(now, last_ui_ms) >= 1000:
        last_ui_ms = now
        remain = time.ticks_diff(next_send_ms, now)
        if remain < 0:
            remain = 0
        draw_line(66, "next " + str(remain // 1000) + "s", 0x90A0B0)
        if wlan.isconnected():
            draw_line(100, "WiFi OK", 0x60FF90)
        else:
            draw_line(100, "NO WIFI", 0xFF6060)

    time.sleep_ms(50)


if __name__ == "__main__":
    try:
        setup()
        while True:
            loop()
    except (Exception, KeyboardInterrupt) as e:
        try:
            from utility import print_error_msg
            print_error_msg(e)
        except ImportError:
            print("please update to latest firmware")
