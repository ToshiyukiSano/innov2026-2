# DX・IoTデータ処理講座 第2回 実習教材

## 現場Aの測定データ

[現場Aの測定データを開く（Googleスプレッドシート）](https://docs.google.com/spreadsheets/d/1TDOBpsr7aPwyIMrRbO-UeuNlvRa1ZJ6o5NACQNvN3do)

このファイルは、IMPORTRANGEの練習に使う架空データです。講座で使用するGoogleアカウントで開いてください。アクセスできない場合は講師に伝えてください。

## 自分のスプレッドシートに取り込む

1. 自分の「測定データ分析」ファイルに「参照」シートを追加します。
2. 「参照」シートのA1に、次の式を入力します。
3. 式の「現場AのスプレッドシートURL」を、上のリンクを開いたときのURLに置き換えます。
4. `#REF!` が表示されたら、そのセルで「アクセスを許可」をクリックします。

```
=IMPORTRANGE("現場AのスプレッドシートURL", "現場A!A1:G15")
```

見出しと14日分のデータが表示されたら完了です。参照元ファイルを自分のGoogle Driveにコピーする必要はありません。

QUERYの練習は講座スライドP42を確認してください。

## P43　3つの記録を1つの表にまとめる

配布された集計用テンプレートを開き、［ファイル］→［コピーを作成］で自分用のコピーを作ります。「リンク」シートには次のURLが入力済みです。

| セル | 記録元 |
| --- | --- |
| B2 | [現場A](https://docs.google.com/spreadsheets/d/1TDOBpsr7aPwyIMrRbO-UeuNlvRa1ZJ6o5NACQNvN3do) |
| B3 | [現場B](https://docs.google.com/spreadsheets/d/1VIy7f0svUV3aGCxo6g7B4ScA85jb6wXv5yrfR4rv55w) |
| B4 | [担当者C](https://docs.google.com/spreadsheets/d/1v5fuB3Qwc3gPmhvfymziyBjUKEErM-SJQp4c6D0nfCU) |

### 1. 各ファイルの記録を取り込む

各取込シートのA1に、対応する式を入力します。接続を求める表示が出たら、そのセルで［アクセスを許可］をクリックします。

**現場A取込**

```
=IMPORTRANGE(リンク!B2, "現場A!A1:G15")
```

**現場B取込**

```
=IMPORTRANGE(リンク!B3, "現場B!A1:G15")
```

**担当者C取込**

```
=IMPORTRANGE(リンク!B4, "担当者C!A1:G15")
```

### 2. 42件の記録をまとめる

「集計」シートのA1に次の式を入力します。現場Bと担当者Cは2行目から取り込み、現場Aの見出しだけを残します。

```
={'現場A取込'!A1:G15;'現場B取込'!A2:G15;'担当者C取込'!A2:G15}
```

1行目が見出し、2〜43行目に3つの記録元のデータが14件ずつ並べば完了です。
